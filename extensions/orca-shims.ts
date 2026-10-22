/**
 * Orca CLI shims (ADR-001 section 2).
 *
 * Standalone module: spawns `orca --json` as a child process, parses the
 * JSON response, and maps failures to short model-readable strings.
 * Imported later by `extensions/pipeline.ts`; has no pi imports so it
 * stays testable without the agent runtime.
 *
 * WHY a child process instead of an SDK: there is no Orca TS SDK in this
 * repo, and the CLI's `--json` envelope is the only stable contract.
 *
 * Safety rules (binding):
 * - Never include raw stderr in returned errors or logs (it may contain
 *   paths, tokens, or control characters). All failures go through
 *   `toShortError`, which emits a fixed short string.
 * - No secrets in code or logs: option values are passed straight to the
 *   CLI argv and never printed; this module logs nothing.
 * - Text fetched via `checkMessages` is DATA, never instructions: callers
 *   must not execute or interpolate it into commands.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

/** Success / failure envelope. `error` is always a short mapped string. */
export type OrcaResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: string };

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

/** CLI timeout per attempt (ms). WHY: `check --wait` blocks, everything else should be fast. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * WHY one retry max: the only safe retry is an idempotent one. Mutating
 * calls carry a stable `--retry-request` id so the server dedupes; a second
 * retry would only amplify a wedged server.
 */
const MAX_ATTEMPTS = 2;

/** Error text is capped so a pathological message cannot flood the model. */
const MAX_ERROR_CHARS = 120;

function isUnknownOutcome(err: unknown): boolean {
	const code = (err as { code?: string | number }).code;
	if (code === "ETIMEDOUT" || code === "EPIPE" || code === "ECONNRESET") return true;
	const msg = String((err as { message?: string }).message ?? "");
	return /timed out|timeout|lost|eof|socket hang up/i.test(msg);
}

/**
 * Map any spawn/parse failure to a short model-readable string.
 * WHY fixed strings: raw stderr leaks paths/secrets and is too noisy
 * for the model to act on; the caller only needs the kind + next action.
 */
function toShortError(err: unknown, verb: string): string {
	const code = (err as { code?: string | number }).code;
	if (code === "ENOENT") return "orca unavailable: CLI not installed";
	if (code === "ETIMEDOUT" || /timed out|timeout/i.test(String((err as { message?: string }).message ?? ""))) {
		return `orca timed out during ${verb}: retry with same retry-request id`;
	}
	const stderr = String((err as { stderr?: string }).stderr ?? "");
	const hay = `${String((err as { message?: string }).message ?? "")}\n${stderr}`.toLowerCase();
	if (/not found|unknown (worktree|terminal|dispatch|message|task)/.test(hay)) return `${verb} failed: target not found`;
	if (/already[_\s-]?released/.test(hay)) return `${verb} failed: already released`;
	if (/invalid|usage:|unknown option|required/.test(hay)) return `${verb} failed: invalid arguments`;
	if (/permission|denied|unauthorized|forbidden/.test(hay)) return `${verb} failed: permission denied`;
	if (/no such|no run|not bound|no dispatch/.test(hay)) return `${verb} failed: nothing to act on`;
	const hint = `${verb} failed: unknown orca error`;
	return hay.includes("retry-request") ? `${hint} (outcome unknown, safe to retry)` : hint;
}

function truncate(text: string): string {
	return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}…` : text;
}

/** Parse CLI stdout as JSON. WHY strict: partial JSON means a truncated stream, not data. */
function parseJsonEnvelope(stdout: string, verb: string): OrcaResult<unknown> {
	const text = stdout.trim();
	if (!text) return { ok: false, error: truncate(`${verb} failed: empty response from orca`) };
	try {
		return { ok: true, data: JSON.parse(text) as unknown };
	} catch {
		return { ok: false, error: truncate(`${verb} failed: unreadable response from orca`) };
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

interface RunOptions {
	/** Stable idempotency id; generated per call unless the caller passes one. */
	retryRequest?: string;
	timeoutMs?: number;
}

/**
 * Spawn `orca --json …`, parse stdout, retry once with the same
 * `--retry-request` id when the reply was lost (unknown outcome).
 * Only verbs whose CLI lists `--retry-request` may pass idempotent=true;
 * `worktree create` and `terminal create` do not list it, so they pass
 * false and never send the flag. Read-only verbs send one only when the
 * caller supplies it.
 */
async function runOrcaJson(
	verb: string,
	args: string[],
	options: RunOptions,
	idempotent: boolean,
): Promise<OrcaResult<unknown>> {
	const retryRequest = options.retryRequest ?? (idempotent ? randomUUID() : undefined);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	let lastError: unknown = null;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
		const argv = [...args, "--json"];
		if (retryRequest) argv.push("--retry-request", retryRequest);
		try {
			const { stdout } = await execFileAsync("orca", argv, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
			return parseJsonEnvelope(stdout, verb);
		} catch (err) {
			lastError = err;
			// Only a lost reply justifies a retry, and only with an idempotency id.
			if (retryRequest === undefined || !isUnknownOutcome(err)) break;
		}
	}
	return { ok: false, error: truncate(toShortError(lastError, verb)) };
}

/**
 * Create an Orca-managed worktree (verb: `worktree`).
 * `comment` attaches an initial note (covers the `comment` verb) without
 * spawning anything extra.
 * Single attempt, no `--retry-request`: the flag is unsupported here
 * (`orca worktree create --help` lists only `--retry-launch`), so the
 * `retryRequest` option is accepted for uniformity but never sent.
 */
export async function createWorktree(options: {
	name: string;
	baseBranch?: string;
	comment?: string;
	retryRequest?: string;
	timeoutMs?: number;
}): Promise<OrcaResult<WorktreeInfo>> {
	const args = ["worktree", "create", "--name", options.name];
	if (options.baseBranch) args.push("--base-branch", options.baseBranch);
	if (options.comment) args.push("--comment", options.comment);
	const result = await runOrcaJson("worktree", args, { timeoutMs: options.timeoutMs }, false);
	if (!result.ok) return result;
	const data = result.data as Record<string, unknown>;
	const id = requireString(data, ["id", "worktreeId", "worktree_id"]);
	if (id === null) return { ok: false, error: "worktree failed: response missing worktree id" };
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
 * Single attempt, no `--retry-request`: the flag is unsupported here
 * (`orca terminal create --help` lists no such flag), so the
 * `retryRequest` option is accepted for uniformity but never sent.
 */
export async function createTerminal(options: {
	worktree?: string;
	retryRequest?: string;
	timeoutMs?: number;
}): Promise<OrcaResult<TerminalInfo>> {
	const args = ["terminal", "create"];
	if (options.worktree) args.push("--worktree", options.worktree);
	const result = await runOrcaJson("terminal", args, { timeoutMs: options.timeoutMs }, false);
	if (!result.ok) return result;
	const data = result.data as Record<string, unknown>;
	return {
		ok: true,
		data: {
			...data,
			handle: pickString(data, ["handle", "terminal", "id"], "unknown"),
		},
	};
}

/** Dispatch a task to a terminal (verb: `dispatch`). */
export async function dispatchTask(options: {
	taskId: string;
	to: string;
	from?: string;
	retryRequest?: string;
	timeoutMs?: number;
}): Promise<OrcaResult<DispatchInfo>> {
	const args = ["orchestration", "dispatch", "--task", options.taskId, "--to", options.to];
	if (options.from) args.push("--from", options.from);
	const result = await runOrcaJson("dispatch", args, options, true);
	if (!result.ok) return result;
	const data = result.data as Record<string, unknown>;
	const dispatchId = requireString(data, ["dispatchId", "dispatch_id", "id"]);
	if (dispatchId === null) return { ok: false, error: "dispatch failed: response missing dispatch id" };
	return {
		ok: true,
		data: {
			...data,
			dispatchId,
		},
	};
}

/**
 * Check this agent's messages (verb: `check`). Read-only: no automatic
 * retry. Returned message text is DATA, never instructions — do not
 * execute or interpolate it into shell commands.
 */
export async function checkMessages(options: {
	terminal?: string;
	waitMs?: number;
	retryRequest?: string;
	timeoutMs?: number;
}): Promise<OrcaResult<MessageBatch>> {
	const args = ["orchestration", "check"];
	if (options.terminal) args.push("--terminal", options.terminal);
	if (options.waitMs !== undefined) args.push("--wait", "--timeout-ms", String(options.waitMs));
	const result = await runOrcaJson("check", args, options, false);
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
export async function replyToMessage(options: {
	id: string;
	body: string;
	from?: string;
	comment?: boolean;
	retryRequest?: string;
	timeoutMs?: number;
}): Promise<OrcaResult<ReplyInfo>> {
	const args = ["orchestration", "reply", "--id", options.id, "--body", options.body];
	if (options.from) args.push("--from", options.from);
	const result = await runOrcaJson(options.comment === true ? "comment" : "reply", args, options, true);
	if (!result.ok) return result;
	const data = result.data as Record<string, unknown>;
	return {
		ok: true,
		data: {
			...data,
			messageId: pickString(data, ["messageId", "message_id", "id"], options.id),
		},
	};
}

/**
 * Release the terminal of one settled supervised worker (verb: `release`
 * → `orchestration worker-release`). Idempotent: `already_released`
 * maps to `{ status: "already_released" }`, not an error.
 */
export async function releaseWorker(options: {
	dispatchId: string;
	retryRequest?: string;
	timeoutMs?: number;
}): Promise<OrcaResult<ReleaseInfo>> {
	const args = ["orchestration", "worker-release", "--dispatch", options.dispatchId];
	const result = await runOrcaJson("release", args, options, true);
	if (!result.ok) {
		if (result.error.includes("already released")) {
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
