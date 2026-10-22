/**
 * Jev gate (ADR-001 section 1, sprint-01 skeleton).
 *
 * Standalone module: pure routing helper, imported later by
 * `extensions/pipeline.ts`. It performs no extension registration itself.
 *
 * Routing rule (from ARCHITECTURE.md): a task goes to `frontier` when
 * `arch.p >= 0.7`, `risk >= 1.5`, or `owner == frontier`; otherwise `general`.
 *
 * Budget caps (`maxRequests` / `maxUsdPerDay`) are enforced in-process before
 * any classifier call. When Jev is unreachable (model missing from the
 * catalog, `classify` throws, or answers are unusable) the gate falls back to
 * the default route and marks the result `degraded` so the caller can log it.
 *
 * Security: only `ctx.modelRegistry` is touched (inherited credentials, never
 * read here); task text is passed to the classifier as data, never executed.
 * No secrets are stored or logged by this module.
 */

import type {
	ClassifierApi,
	ClassifierContext,
	ClassifierModel,
	ClassifierResult,
} from "@earendil-works/pi-ai";

/** Classifier identity pinned by the ADR. */
export const JEV_PROVIDER = "opencode";
export const JEV_MODEL_ID = "jev-1.13-free";
export const JEV_DECIDED_BY = "jev-1.13-free";

/** Route the gate can return. */
export type JevRoute = "general" | "frontier";

/** Task description to route. Plain data; never interpreted as instructions. */
export interface JevGateInput {
	title: string;
	body?: string;
	files?: string[];
}

/** Budget caps enforced before each classifier call. */
export interface JevGateCaps {
	/** Max classify calls per process (sprint budget guard). */
	maxRequests: number;
	/** Max accumulated classifier spend in USD per calendar day (UTC). */
	maxUsdPerDay: number;
}

/** Minimal registry surface the gate needs; `ExtensionContext` satisfies it. */
export interface JevGateRegistry {
	findOfType(
		type: "classifier",
		provider: string,
		modelId: string,
	): ClassifierModel<ClassifierApi> | undefined;
	classify(
		model: ClassifierModel<ClassifierApi>,
		context: ClassifierContext,
		options?: { signal?: AbortSignal },
	): Promise<ClassifierResult>;
}

/** Context the gate reads the registry from; structurally satisfied by `ExtensionContext`. */
export interface JevGateContext {
	modelRegistry: JevGateRegistry;
}

/** Gate verdict. `degraded` means the fallback default was used. */
export interface JevGateResult {
	route: JevRoute;
	/** 0..1 confidence in `route`; `0` when no classifier signal was available. */
	confidence: number;
	/** Who decided: `jev-1.13`, or `jev-1.13:<cause>` for fallbacks. */
	decidedBy: string;
	degraded: boolean;
}

/** Sensible sprint defaults; callers may override per dispatch. */
export const DEFAULT_JEV_CAPS: JevGateCaps = {
	maxRequests: 200,
	maxUsdPerDay: 1,
};

/** Fallback route when Jev gives no signal. */
export const DEFAULT_JEV_ROUTE: JevRoute = "general";

/** Thresholds from ARCHITECTURE.md section 3. */
const ARCH_FRONTIER_PROBABILITY = 0.7;
const RISK_FRONTIER_SCORE = 1.5;

/** Upper bound on state text sent to the classifier (keeps requests cheap). */
const MAX_STATE_CHARS = 8000;

/** In-process spend ledger for cap enforcement. */
interface JevGateLedger {
	requests: number;
	usdToday: number;
	dayKey: string;
}

const ledger: JevGateLedger = { requests: 0, usdToday: 0, dayKey: utcDayKey() };

function utcDayKey(now = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/** Test/smoke hook: clears the in-process cap counters. */
export function resetJevGateUsage(): void {
	ledger.requests = 0;
	ledger.usdToday = 0;
	ledger.dayKey = utcDayKey();
}

function fallbackResult(reason: string): JevGateResult {
	return { route: DEFAULT_JEV_ROUTE, confidence: 0, decidedBy: `${JEV_DECIDED_BY}:${reason}`, degraded: true };
}

function truncate(text: string, max = MAX_STATE_CHARS): string {
	return text.length > max ? text.slice(0, max) : text;
}

/** Builds the classifier context; task text travels as opaque state data. */
function buildClassifierContext(input: JevGateInput): ClassifierContext {
	const files = (input.files ?? []).slice(0, 32);
	return {
		state: {
			title: truncate(input.title),
			body: truncate(input.body ?? ""),
			files: files.map((file) => truncate(file, 512)),
		},
		questions: {
			arch: {
				type: "bool",
				instructions: "Does this task involve system architecture, API/DB design, auth, or another cross-cutting decision?",
				criteria: {
					true: "Architecture, API/DB design, auth/security, migration, or system-wide design choice",
					false: "Local implementation, tests, docs, or routine change with no system-wide impact",
				},
			},
			risk: {
				type: "score",
				instructions: "How risky or irreversible is this task if done wrong?",
				criteria: ["0 = trivially reversible", "1 = normal implementation risk", "2 = destructive or hard-to-reverse (data loss, deploy-wide, security)"],
			},
			owner: {
				type: "choice",
				instructions: "Which model tier should own this task?",
				criteria: {
					general: "Routine implementation, tests, or docs for the general tier",
					frontier: "Architecture, review, or complex debugging needing the frontier tier",
				},
			},
		},
	};
}

/**
 * Routes one task through the `opencode/jev-1.13` classifier.
 *
 * Never rejects on classifier failure: any Jev outage degrades to the
 * default route with `degraded: true` instead of throwing.
 */
export async function jevGate(
	ctx: JevGateContext,
	input: JevGateInput,
	caps: JevGateCaps = DEFAULT_JEV_CAPS,
	signal?: AbortSignal,
): Promise<JevGateResult> {
	if (utcDayKey() !== ledger.dayKey) resetJevGateUsage();
	if (ledger.requests >= caps.maxRequests) return fallbackResult("caps-requests");
	if (ledger.usdToday >= caps.maxUsdPerDay) return fallbackResult("caps-usd");

	const model = ctx.modelRegistry.findOfType("classifier", JEV_PROVIDER, JEV_MODEL_ID);
	if (!model) return fallbackResult("unavailable");

	let result: ClassifierResult;
	try {
		result = await ctx.modelRegistry.classify(model, buildClassifierContext(input), { signal });
	} catch {
		return fallbackResult("error");
	}
	if (result.stopReason !== "stop") return fallbackResult("error");

	ledger.requests += 1;
	ledger.usdToday += result.usage?.cost.total ?? 0;

	const arch = result.answers.arch;
	const risk = result.answers.risk;
	const owner = result.answers.owner;
	if (arch?.type !== "bool" || risk?.type !== "score" || owner?.type !== "choice") {
		return fallbackResult("malformed");
	}

	// `arch` is a bool question; `probability` is P(true), i.e. P(architecture work).
	const triggers: number[] = [];
	if (arch.probability >= ARCH_FRONTIER_PROBABILITY) triggers.push(arch.probability);
	if (risk.score >= RISK_FRONTIER_SCORE) triggers.push(risk.confidence);
	const ownerIsFrontier = owner.choice === "frontier";
	if (ownerIsFrontier) triggers.push(owner.confidence);

	if (triggers.length > 0) {
		return {
			route: "frontier",
			confidence: Math.max(...triggers),
			decidedBy: JEV_DECIDED_BY,
			degraded: false,
		};
	}
	return {
		route: "general",
		// No frontier signal: trust the owner's vote for `general`, discounted
		// by any partial architecture probability the classifier saw.
		confidence: owner.confidence * (1 - arch.probability),
		decidedBy: JEV_DECIDED_BY,
		degraded: false,
	};
}
