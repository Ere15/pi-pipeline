/**
 * jev-gate behavior tests (ADR-002 section 2).
 *
 * WHY mocked registry: the gate's contract is routing plus caps plus
 * degraded fallback. A live classifier would make these tests flaky and
 * billable, so every branch runs against a canned `findOfType`/`classify`.
 * This file imports only the pure gate module — no pi runtime.
 */

import { ok, strictEqual } from "node:assert/strict";
import {
	DEFAULT_JEV_ROUTE,
	JEV_DECIDED_BY,
	jevGate,
	resetJevGateUsage,
} from "./jev-gate.ts";
import type { JevGateContext } from "./jev-gate.ts";

/** Canned classifier signal for one test. */
interface CannedSignal {
	archProbability: number;
	riskScore: number;
	riskConfidence: number;
	ownerChoice: "general" | "frontier";
	ownerConfidence: number;
}

interface MockOptions extends Partial<CannedSignal> {
	modelPresent?: boolean;
	shouldThrow?: boolean;
	stopReason?: string;
	malformed?: boolean;
	usageTotal?: number;
}

/** Quiet signal: nothing frontier-worthy. */
const QUIET: CannedSignal = {
	archProbability: 0.1,
	riskScore: 0.2,
	riskConfidence: 0.9,
	ownerChoice: "general",
	ownerConfidence: 0.8,
};

const GENEROUS_CAPS = { maxRequests: 100, maxUsdPerDay: 1000 };

/**
 * Builds a registry double shaped like `JevGateRegistry` plus a call
 * counter. Casts stay inside the pure gate module's types, so no pi
 * imports leak into the test.
 */
function mockRegistry(options: MockOptions = {}): {
	ctx: JevGateContext;
	calls: { classify: number };
} {
	const calls = { classify: 0 };
	const signal: CannedSignal = {
		archProbability: options.archProbability ?? QUIET.archProbability,
		riskScore: options.riskScore ?? QUIET.riskScore,
		riskConfidence: options.riskConfidence ?? QUIET.riskConfidence,
		ownerChoice: options.ownerChoice ?? QUIET.ownerChoice,
		ownerConfidence: options.ownerConfidence ?? QUIET.ownerConfidence,
	};
	const model = options.modelPresent === false ? undefined : ({} as never);
	return {
		calls,
		ctx: {
			modelRegistry: {
				findOfType: () => model,
				classify: (() => {
					calls.classify += 1;
					if (options.shouldThrow === true) throw new Error("classifier down");
					const answers = options.malformed === true
						? {
							arch: { type: "score", score: 1, confidence: 1 },
							risk: { type: "bool", probability: 1 },
							owner: { type: "bool", probability: 0 },
						}
						: {
							arch: { type: "bool", probability: signal.archProbability },
							risk: {
								type: "score",
								score: signal.riskScore,
								confidence: signal.riskConfidence,
							},
							owner: {
								type: "choice",
								choice: signal.ownerChoice,
								confidence: signal.ownerConfidence,
							},
						};
					return Promise.resolve({
						stopReason: options.stopReason ?? "stop",
						usage: { cost: { total: options.usageTotal ?? 0 } },
						answers,
					});
				}) as never,
			},
		},
	};
}

const INPUT = { title: "migrate auth table", body: "add column", files: ["db.ts"] };

Deno.test("routes frontier when architecture probability reaches 0.7", async () => {
	resetJevGateUsage();
	const { ctx } = mockRegistry({ archProbability: 0.9 });
	const verdict = await jevGate(ctx, INPUT, GENEROUS_CAPS);
	strictEqual(verdict.route, "frontier");
	strictEqual(verdict.confidence, 0.9);
	strictEqual(verdict.decidedBy, JEV_DECIDED_BY);
	strictEqual(verdict.degraded, false);
});

Deno.test("treats exactly 0.7 architecture probability as frontier", async () => {
	resetJevGateUsage();
	const { ctx } = mockRegistry({ archProbability: 0.7 });
	const verdict = await jevGate(ctx, INPUT, GENEROUS_CAPS);
	strictEqual(verdict.route, "frontier");
	strictEqual(verdict.degraded, false);
});

Deno.test("routes frontier when risk score reaches 1.5", async () => {
	resetJevGateUsage();
	const { ctx } = mockRegistry({ riskScore: 1.8, riskConfidence: 0.6 });
	const verdict = await jevGate(ctx, INPUT, GENEROUS_CAPS);
	strictEqual(verdict.route, "frontier");
	strictEqual(verdict.confidence, 0.6);
	strictEqual(verdict.degraded, false);
});

Deno.test("treats exactly 1.5 risk score as frontier", async () => {
	resetJevGateUsage();
	const { ctx } = mockRegistry({ riskScore: 1.5, riskConfidence: 0.4 });
	const verdict = await jevGate(ctx, INPUT, GENEROUS_CAPS);
	strictEqual(verdict.route, "frontier");
	strictEqual(verdict.degraded, false);
});

Deno.test("routes frontier when the owner votes frontier", async () => {
	resetJevGateUsage();
	const { ctx } = mockRegistry({ ownerChoice: "frontier", ownerConfidence: 0.75 });
	const verdict = await jevGate(ctx, INPUT, GENEROUS_CAPS);
	strictEqual(verdict.route, "frontier");
	strictEqual(verdict.confidence, 0.75);
	strictEqual(verdict.degraded, false);
});

Deno.test("routes general with discounted confidence when no signal fires", async () => {
	resetJevGateUsage();
	const { ctx } = mockRegistry({
		archProbability: 0.2,
		riskScore: 0.5,
		ownerChoice: "general",
		ownerConfidence: 0.8,
	});
	const verdict = await jevGate(ctx, INPUT, GENEROUS_CAPS);
	strictEqual(verdict.route, "general");
	ok(Math.abs(verdict.confidence - 0.8 * (1 - 0.2)) < 1e-9, `discounted confidence off: ${verdict.confidence}`);
	strictEqual(verdict.decidedBy, JEV_DECIDED_BY);
	strictEqual(verdict.degraded, false);
});

Deno.test("falls back degraded when the model is missing and never classifies", async () => {
	resetJevGateUsage();
	const { ctx, calls } = mockRegistry({ modelPresent: false });
	const verdict = await jevGate(ctx, INPUT, GENEROUS_CAPS);
	strictEqual(verdict.route, DEFAULT_JEV_ROUTE);
	strictEqual(verdict.confidence, 0);
	strictEqual(verdict.decidedBy, `${JEV_DECIDED_BY}:unavailable`);
	strictEqual(verdict.degraded, true);
	strictEqual(calls.classify, 0);
});

Deno.test("falls back degraded when classify throws", async () => {
	resetJevGateUsage();
	const { ctx, calls } = mockRegistry({ shouldThrow: true });
	const verdict = await jevGate(ctx, INPUT, GENEROUS_CAPS);
	strictEqual(verdict.route, DEFAULT_JEV_ROUTE);
	strictEqual(verdict.confidence, 0);
	strictEqual(verdict.decidedBy, `${JEV_DECIDED_BY}:error`);
	strictEqual(verdict.degraded, true);
	strictEqual(calls.classify, 1);
});

Deno.test("falls back degraded when the classifier does not stop", async () => {
	resetJevGateUsage();
	const { ctx } = mockRegistry({ stopReason: "length" });
	const verdict = await jevGate(ctx, INPUT, GENEROUS_CAPS);
	strictEqual(verdict.route, DEFAULT_JEV_ROUTE);
	strictEqual(verdict.decidedBy, `${JEV_DECIDED_BY}:error`);
	strictEqual(verdict.degraded, true);
});

Deno.test("falls back degraded on malformed answers", async () => {
	resetJevGateUsage();
	const { ctx } = mockRegistry({ malformed: true });
	const verdict = await jevGate(ctx, INPUT, GENEROUS_CAPS);
	strictEqual(verdict.route, DEFAULT_JEV_ROUTE);
	strictEqual(verdict.confidence, 0);
	strictEqual(verdict.decidedBy, `${JEV_DECIDED_BY}:malformed`);
	strictEqual(verdict.degraded, true);
});

Deno.test("enforces the request cap before calling classify", async () => {
	resetJevGateUsage();
	const { ctx, calls } = mockRegistry({});
	const caps = { maxRequests: 1, maxUsdPerDay: 1000 };
	const first = await jevGate(ctx, INPUT, caps);
	strictEqual(first.degraded, false);
	const second = await jevGate(ctx, INPUT, caps);
	strictEqual(second.route, DEFAULT_JEV_ROUTE);
	strictEqual(second.decidedBy, `${JEV_DECIDED_BY}:caps-requests`);
	strictEqual(second.degraded, true);
	strictEqual(calls.classify, 1);
});

Deno.test("enforces the daily spend cap from accumulated usage", async () => {
	resetJevGateUsage();
	const { ctx, calls } = mockRegistry({ usageTotal: 0.6 });
	const caps = { maxRequests: 100, maxUsdPerDay: 0.5 };
	const first = await jevGate(ctx, INPUT, caps);
	strictEqual(first.degraded, false);
	const second = await jevGate(ctx, INPUT, caps);
	strictEqual(second.decidedBy, `${JEV_DECIDED_BY}:caps-usd`);
	strictEqual(second.degraded, true);
	strictEqual(calls.classify, 1);
});

Deno.test("applies a zero spend cap without calling classify", async () => {
	resetJevGateUsage();
	const { ctx, calls } = mockRegistry({});
	const verdict = await jevGate(ctx, INPUT, { maxRequests: 100, maxUsdPerDay: 0 });
	strictEqual(verdict.decidedBy, `${JEV_DECIDED_BY}:caps-usd`);
	strictEqual(verdict.degraded, true);
	strictEqual(calls.classify, 0);
});

Deno.test("reset hook clears the caps so the gate classifies again", async () => {
	resetJevGateUsage();
	const { ctx, calls } = mockRegistry({});
	const caps = { maxRequests: 1, maxUsdPerDay: 1000 };
	await jevGate(ctx, INPUT, caps);
	const capped = await jevGate(ctx, INPUT, caps);
	ok(capped.degraded);
	resetJevGateUsage();
	const afterReset = await jevGate(ctx, INPUT, caps);
	strictEqual(afterReset.degraded, false);
	strictEqual(calls.classify, 2);
});
