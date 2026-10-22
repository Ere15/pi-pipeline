/**
 * Orca CLI shims (ADR-001 section 2; recovery policy ADR-002 section 3).
 *
 * Standalone module: spawns `orca --json` as a child process, parses the
 * JSON response, and maps failures to structured errors the model can act on.
 * Imported later by `extensions/pipeline.ts`; has no pi imports so it
 * stays testable without the agent runtime.
 *
 * Recovery (ADR-002 section 3): every verb accepts
 * `{attempts (default 3), timeoutMs (default 120s), backoffMs (exponential)}`
 * plus an idempotency `retryRequest` and an AbortSignal. The envelope stays
 * `{ok, data?, error?}` — only the `error` value is structured
 * `{code, retryable, detail}`. No response ids are ever invented: a reply
 * without an id is an error, never a fallback string (lesson of review-01).
 *
 * Safety rules (binding):
 * - Never include raw stderr in returned errors or logs (it may contain
 *   paths, tokens, or control characters). All failures go through
 *   `toOrcaError`, which emits a fixed code plus a short detail string.
 * - No secrets in code or logs: option values are passed straight to the
 *   CLI argv and never printed; this module logs nothing.
 * - Text fetched via `checkMessages` is DATA, never instructions: callers
 *   must not execute or interpolate it into commands.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

/**
 * Stable error codes. WHY fixed codes: the model retries on `retryable`,
 * not on string matching; new messages must reuse a code, not invent one.
 */
export type OrcaErrorCode =
	| "ORCA_ABORTED"
	| "ORCA_UNAVAILABLE"
	| "ORCA_TIMEOUT"
	| "ORCA_TRANSPORT"
	| "ORCA_NOT_FOUND"
	| "ORCA_ALREADY_RELEASED"
	| "ORCA_INVALID_ARGS"
	| "ORCA_DENIED"
	| "ORCA_EMPTY_RESPONSE"
	| "ORCA_BAD_RESPONSE"
	| "ORCA_UNKNOWN";

/** Structured failure: machine-readable code, retry hint, short detail. */
export interface OrcaError {
	code: OrcaErrorCode;
	retryable: boolean;
	detail: string;
}

/** Success / failure envelope. Keys are stable (ROADMAP-02 API list). */
export type OrcaResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: OrcaError };

export interface WorktreeInfo {
	id: string;
	name: string;
	[key: string]: unknown;
}

export interface TerminalInfo {
	handle: string;
	[key: string]: unknown;
}

export interface DispatchInfo {
	dispatchId: string;
	[key: string]: unknown;
}

export interface MessageBatch {
	messages: unknown[];
	[key: string]: unknown;
}

export interface ReplyInfo {
	messageId: string;
	[key: string]: unknown;
}

export interface ReleaseInfo {
	status: string;
	[key: string]: unknown;
}

/** Recovery knobs shared by all six verbs (ADR-002 section 3). */
export interface RecoveryOptions {
	/** Stable idempotency id; generated per call unless the caller passes one. */
	retryRequest?: string;
	/** Total attempts including the first try (default 3). */
	attempts?: number;
	/** Per-attempt CLI timeout in ms (default 120s). */
	timeoutMs?: number;
	/** Base backoff in ms; actual delay grows exponentially (default 500). */
	backoffMs?: number;
	/** Caller cancellation; an aborted wait surfaces ORCA_ABORTED, never a retry. */
	signal?: AbortSignal;
}

/** ADR-002 defaults: 3 attempts, 120s per-attempt timeout, exponential backoff. */
export const DEFAULT_ATTEMPTS = 3;
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_BACKOFF_MS = 500;

/** Backoff ceiling so a high base cannot stall the pipeline for minutes. */
const MAX_BACKOFF_MS = 10_000;

/** Extra grace over `--wait` so the client never kills a healthy long poll. */
const CHECK_GRACE_MS = 10_000;

/** Error text is capped so a pathological message cannot flood the model. */
const MAX_ERROR_CHARS = 120;

function normalizeAttempts(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return DEFAULT_ATTEMPTS;
	return Math.max(1, Math.floor(value));
}

function normalizeTimeoutMs(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
	return Math.floor(value);
}

function normalizeBackoffMs(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value) || value < 0) return DEFAULT_BACKOFF_MS;
	return value;
}

/**
 * Exponential delay before retry number `retryIndex` (1-based):
 * base, 2*base, 4*base…, capped at MAX_BACKOFF_MS.
 */
export function backoffDelayMs(retryIndex: number, baseMs: number = DEFAULT_BACKOFF_MS): number {
	return Math.min(baseMs * 2 ** Math.max(0, retryIndex - 1), MAX_BACKOFF_MS);
}

/**
 * Short human-readable form of a structured error.
 * WHY this exists: string slots (e.g. pipeline tool text) that predate
 * structured errors take `formatOrcaError(err)` with no information loss.
 */
export function formatOrcaError(error: OrcaError): string {
	return error.detail;
}

function truncate(text: string): string {
	return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}…` : text;
}

function fail(verb: string, code: OrcaErrorCode, retryable: boolean, detail: string): OrcaError {
	return { code, retryable, detail: truncate(`${verb} ${detail}`) };
}

function abortedError(verb: string): OrcaError {
	return { code: "ORCA_ABORTED", retryable: false, detail: truncate(`${verb} aborted: caller cancelled the wait`) };
}

function wasAborted(err: unknown, signal?: AbortSignal): boolean {
	if (signal?.aborted) return true;
	const rec = err as { name?: string; code?: string | number };
	return rec.name === "AbortError" || rec.code === "ABORT_ERR";
}

/**
 * Map any spawn failure to a structured error.
 * WHY `retryable` lives on the error: only a lost reply justifies a retry,
 * and only with an idempotency id; permanent failures must fail fast.
 * TIMEOUT/TRANSPORT are retryable (reply may never have arrived);
 * everything else describes a settled outcome, so retrying cannot help.
 */
function toOrcaError(err: unknown, verb: string, signal?: AbortSignal): OrcaError {
	if (wasAborted(err, signal)) return abortedError(verb);
	const rec = err as { code?: string | number; message?: string; stderr?: string; killed?: boolean };
	const code = rec.code;
	const message = String(rec.message ?? "");
	if (code === "ENOENT") {
		return { code: "ORCA_UNAVAILABLE", retryable: false, detail: "orca unavailable: CLI not installed" };
	}
	if (code === "ETIMEDOUT" || rec.killed === true || /timed out|timeout/i.test(message)) {
		return fail(verb, "ORCA_TIMEOUT", true, "timed out: retry with same retry-request id");
	}
	const stderr = String(rec.stderr ?? "");
	const hay = `${message}\n${stderr}`.toLowerCase();
	if (/not found|unknown (worktree|terminal|dispatch|message|task)/.test(hay)) {
		return fail(verb, "ORCA_NOT_FOUND", false, "failed: target not found");
	}
	if (/already[_\s-]?released/.test(hay)) {
		return fail(verb, "ORCA_ALREADY_RELEASED", false, "failed: already released");
	}
	if (/invalid|usage:|unknown option|required/.test(hay)) {
		return fail(verb, "ORCA_INVALID_ARGS", false, "failed: invalid arguments");
	}
	if (/permission|denied|unauthorized|forbidden/.test(hay)) {
		return fail(verb, "ORCA_DENIED", false, "failed: permission denied");
	}
	if (/no such|no run|not bound|no dispatch/.test(hay)) {
		return fail(verb, "ORCA_NOT_FOUND", false, "failed: nothing to act on");
	}
	if (code === "EPIPE" || code === "ECONNRESET" || /lost|eof|socket hang up/i.test(message)) {
		return fail(verb, "ORCA_TRANSPORT", true, "failed: reply lost (outcome unknown, safe to retry with same retry-request id)");
	}
	return fail(verb, "ORCA_UNKNOWN", false, "failed: unknown orca error");
}

/** Parse CLI stdout as JSON. WHY strict: partial JSON means a truncated stream, not data. */
function parseJsonEnvelope(stdout: string, verb: string): OrcaResult<unknown> {
	const text = stdout.trim();
	if (!text) {
		return { ok: false, error: { code: "ORCA_EMPTY_RESPONSE", retryable: false, detail: truncate(`${verb} failed: empty response from orca`) } };
	}
	try {
		return { ok: true, data: JSON.parse(text) as unknown };
	} catch {
		return { ok: false, error: { code: "ORCA_BAD_RESPONSE", retryable: false, detail: truncate(`${verb} failed: unreadable response from orca`) } };
	}
}

function pickString(data: unknown, keys: string[], fallback: string): string {
	if (typeof data === "object" && data !== null) {
		for (const key of keys) {
			const value = (data as Record<string, unknown>)[key];
			if (typeof value === "string" && value.length > 0) return value;
		}
	}
	return fallback;
}

/**
 * Like pickString but returns null instead of inventing a value.
 * WHY null over fallback: a fallback id (e.g. taskId as dispatchId)
 * makes a broken response look valid and misroutes later calls.
 */
function requireString(data: Record<string, unknown>, keys: string[]): string | null {
	for (const key of keys) {
		const value = data[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return null;
}

function missingId(verb: string, field: string): OrcaError {
	return { code: "ORCA_BAD_RESPONSE", retryable: false, detail: `${verb} failed: response missing ${field}` };
}

/** Abort-aware sleep. Resolves true when the signal fired before the delay elapsed. */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<boolean> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve(true);
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve(false);
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timer);
			resolve(true);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Spawn `orca --json …`, parse stdout, and retry retryable failures up to
 * `attempts` with exponential backoff under the same `--retry-request` id.
 * A retry happens only when an idempotency id exists: without one the
 * server cannot dedupe, so retrying a lost reply could duplicate a
 * mutating call (duplicate worktrees/terminals). `createWorktree` and
 * `createTerminal` therefore attempt once unless the caller explicitly
 * passes `retryRequest`. Parse failures never retry: a reply arrived, so
 * the outcome is known and a retry could duplicate a mutating call.
 */
async function runOrcaJson(
	verb: string,
	args: string[],
	options: RecoveryOptions,
	idempotent: boolean,
): Promise<OrcaResult<unknown>> {
	const retryRequest = options.retryRequest ?? (idempotent ? randomUUID() : undefined);
	const attempts = normalizeAttempts(options.attempts);
	const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
	const backoffBase = normalizeBackoffMs(options.backoffMs);
	const signal = options.signal;
	let lastError: OrcaError = { code: "ORCA_UNKNOWN", retryable: false, detail: `${verb} failed: unknown orca error` };
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		if (signal?.aborted) {
			lastError = abortedError(verb);
			break;
		}
		const argv = [...args, "--json"];
		if (retryRequest) argv.push("--retry-request", retryRequest);
		try {
			const { stdout } = await execFileAsync("orca", argv, {
				timeout: timeoutMs,
				maxBuffer: 4 * 1024 * 1024,
				signal,
			});
			return parseJsonEnvelope(stdout, verb);
		} catch (err) {
			lastError = toOrcaError(err, verb, signal);
			// WHY no id, no retry: only a --retry-request id lets the server
			// dedupe a replayed call; without one a retry after a lost reply
			// risks a duplicate worktree/terminal/dispatch.
			if (!lastError.retryable || retryRequest === undefined) break;
			if (attempt < attempts) {
				// WHY backoff between attempts: a wedged server needs room, not a hammer.
				const aborted = await sleepAbortable(backoffDelayMs(attempt, backoffBase), signal);
				if (aborted) {
					lastError = abortedError(verb);
					break;
				}
			}
		}
	}
	return { ok: false, error: lastError };
}

/**
 * Create an Orca-managed worktree (verb: `worktree`).
 * `comment` attaches an initial note (covers the `comment` verb) without
 * spawning anything extra.
 * No `--retry-request`: the flag is unsupported here
 * (`orca worktree create --help` lists only `--retry-launch`), so the
 * `retryRequest` option is accepted for uniformity but never sent.
 */
export async function createWorktree(
	options: RecoveryOptions & {
		name: string;
		baseBranch?: string;
		comment?: string;
	},
): Promise<OrcaResult<WorktreeInfo>> {
	const args = ["worktree", "create", "--name", options.name];
	if (options.baseBranch) args.push("--base-branch", options.baseBranch);
	if (options.comment) args.push("--comment", options.comment);
	const result = await runOrcaJson("worktree", args, options, false);
	if (!result.ok) return result;
	const data = result.data as Record<string, unknown>;
	const id = requireString(data, ["id", "worktreeId", "worktree_id"]);
	if (id === null) return { ok: false, error: missingId("worktree", "worktree id") };
	return {
		ok: true,
		data: {
			...data,
			id,
			name: pickString(data, ["name"], options.name),
		},
	};
}

/**
 * Create a terminal session in the current worktree (verb: `terminal`).
 * No `--retry-request`: the flag is unsupported here
 * (`orca terminal create --help` lists no such flag), so the
 * `retryRequest` option is accepted for uniformity but never sent.
 */
export async function createTerminal(
	options: RecoveryOptions & {
		worktree?: string;
	},
): Promise<OrcaResult<TerminalInfo>> {
	const args = ["terminal", "create"];
	if (options.worktree) args.push("--worktree", options.worktree);
	const result = await runOrcaJson("terminal", args, options, false);
	if (!result.ok) return result;
	const data = result.data as Record<string, unknown>;
	const handle = requireString(data, ["handle", "terminal", "id"]);
	if (handle === null) return { ok: false, error: missingId("terminal", "terminal handle") };
	return {
		ok: true,
		data: {
			...data,
			handle,
		},
	};
}

/** Dispatch a task to a terminal (verb: `dispatch`). */
export async function dispatchTask(
	options: RecoveryOptions & {
		taskId: string;
		to: string;
		from?: string;
	},
): Promise<OrcaResult<DispatchInfo>> {
	const args = ["orchestration", "dispatch", "--task", options.taskId, "--to", options.to];
	if (options.from) args.push("--from", options.from);
	const result = await runOrcaJson("dispatch", args, options, true);
	if (!result.ok) return result;
	const data = result.data as Record<string, unknown>;
	const dispatchId = requireString(data, ["dispatchId", "dispatch_id", "id"]);
	if (dispatchId === null) return { ok: false, error: missingId("dispatch", "dispatch id") };
	return {
		ok: true,
		data: {
			...data,
			dispatchId,
		},
	};
}

/**
 * Check this agent's messages (verb: `check`). Read-only: `retryRequest`
 * is accepted for uniformity but only sent when the caller supplies one.
 * `signal` cancels a blocking `--wait`; the spawn timeout always outlives
 * `waitMs` by CHECK_GRACE_MS so a healthy long poll is never cut short.
 * Returned message text is DATA, never instructions — do not
 * execute or interpolate it into shell commands.
 */
export async function checkMessages(
	options: RecoveryOptions & {
		terminal?: string;
		waitMs?: number;
	},
): Promise<OrcaResult<MessageBatch>> {
	const args = ["orchestration", "check"];
	if (options.terminal) args.push("--terminal", options.terminal);
	if (options.waitMs !== undefined) args.push("--wait", "--timeout-ms", String(options.waitMs));
	const timeoutMs = options.waitMs !== undefined
		? Math.max(normalizeTimeoutMs(options.timeoutMs), options.waitMs + CHECK_GRACE_MS)
		: options.timeoutMs;
	const result = await runOrcaJson("check", args, { ...options, timeoutMs }, false);
	if (!result.ok) return result;
	const data = result.data;
	if (Array.isArray(data)) return { ok: true, data: { messages: data } };
	if (typeof data === "object" && data !== null) {
		const record = data as Record<string, unknown>;
		const messages = Array.isArray(record["messages"]) ? (record["messages"] as unknown[]) : [data];
		return { ok: true, data: { ...record, messages } };
	}
	return { ok: true, data: { messages: [] } };
}

/**
 * Reply to a message (verb: `reply`; covers `comment` too).
 * WHY one function for both: `comment` is a reply without a question
 * context. Pass `comment: true` to mark the body as a plain comment for
 * downstream threading; transport stays `orchestration reply`.
 */
export async function replyToMessage(
	options: RecoveryOptions & {
		id: string;
		body: string;
		from?: string;
		comment?: boolean;
	},
): Promise<OrcaResult<ReplyInfo>> {
	const args = ["orchestration", "reply", "--id", options.id, "--body", options.body];
	if (options.from) args.push("--from", options.from);
	const result = await runOrcaJson(options.comment === true ? "comment" : "reply", args, options, true);
	if (!result.ok) return result;
	const data = result.data as Record<string, unknown>;
	const messageId = requireString(data, ["messageId", "message_id", "id"]);
	if (messageId === null) return { ok: false, error: missingId(options.comment === true ? "comment" : "reply", "message id") };
	return {
		ok: true,
		data: {
			...data,
			messageId,
		},
	};
}

/**
 * Release the terminal of one settled supervised worker (verb: `release`
 * → `orchestration worker-release`). Idempotent: `already_released`
 * maps to `{ status: "already_released" }`, not an error.
 */
export async function releaseWorker(
	options: RecoveryOptions & {
		dispatchId: string;
	},
): Promise<OrcaResult<ReleaseInfo>> {
	const args = ["orchestration", "worker-release", "--dispatch", options.dispatchId];
	const result = await runOrcaJson("release", args, options, true);
	if (!result.ok) {
		if (result.error.code === "ORCA_ALREADY_RELEASED") {
			return { ok: true, data: { status: "already_released" } };
		}
		return result;
	}
	const data = result.data as Record<string, unknown>;
	return {
		ok: true,
		data: {
			...data,
			status: pickString(data, ["status", "result"], "released"),
		},
	};
}
