/**
 * mem0 redaction tests (REVIEW-sprint-02 must-fix 4b).
 *
 * WHY this file exists: `mem0.ts` ships inline redaction examples via
 * `checkRedactionExamples()`, but nothing in `*.test.ts` executed them,
 * so bare `deno test extensions/` never covered redaction. This suite
 * wires the inline examples in and adds direct `redactSecrets()` cases
 * for tokens/keys/passwords/long blobs, plus redaction coverage for
 * `formatStageSummary()` / `buildRecallQuery()`.
 *
 * No permissions needed: everything under test is pure (no I/O, no
 * subprocess, no env). Run: `deno test extensions/mem0.test.ts`.
 *
 * Fixtures are obvious fakes (`TEST-FAKE-*`, repeated `deadbeef`);
 * no real secret material appears here by construction — every value
 * is asserted to be gone from the redacted output anyway.
 */

import {
	buildRecallQuery,
	checkRedactionExamples,
	formatStageSummary,
	REDACTED,
	redactSecrets,
} from "./mem0.ts";

function fail(message: string): never {
	throw new Error(message);
}

/** Assert `output` no longer contains `secret`. */
function assertRedacted(output: string, secret: string, label: string): void {
	if (output.includes(secret)) fail(`${label}: secret survived redaction: ${JSON.stringify(secret)}`);
	if (!output.includes(REDACTED)) fail(`${label}: no ${REDACTED} marker in: ${JSON.stringify(output)}`);
}

Deno.test("inline redaction examples all pass", () => {
	const checks = checkRedactionExamples();
	if (checks.length === 0) fail("expected at least one inline redaction example");
	const failed = checks.filter((check) => !check.passed).map((check) => check.name);
	if (failed.length > 0) fail(`inline examples failed: ${failed.join(", ")}`);
});

Deno.test("redactSecrets removes api key / token / password assignments", () => {
	const cases: Array<[string, string]> = [
		["api key", "api_key=TEST-FAKE-KEY-12345"],
		["token", "auth_token=TEST-FAKE-TOKEN-67890"],
		["password", "password: TEST-FAKE-PASSWORD"],
		["client secret", 'client_secret="TEST-FAKE-SECRET"'],
	];
	for (const [label, secret] of cases) {
		assertRedacted(redactSecrets(`config line ${secret} trailing prose`), secret, label);
	}
});

Deno.test("redactSecrets removes bearer tokens and deny-list prefixes", () => {
	const bearer = "Bearer VEVTVC1GQUtFLUJFQVJFUi1UT0tFTg";
	const out = redactSecrets(`Authorization: ${bearer}`);
	assertRedacted(out, "VEVTVC1GQUtFLUJFQVJFUi1UT0tFTg", "bearer");

	const fakes = ["sk-ant-TEST-FAKE-0000", "ghp_TEST-FAKE-0000", "github_pat_TEST-FAKE-0000"];
	for (const fake of fakes) {
		assertRedacted(redactSecrets(`leaked ${fake} in log`), fake, `deny-list ${fake}`);
	}
});

Deno.test("redactSecrets removes long base64 and hex blobs", () => {
	const blob = "VEVTVEZBS0VWEVTVEZBS0VWEVTVEZBS0VWEVTVEZBS0VWEVTVA==";
	assertRedacted(redactSecrets(`blob ${blob} end`), blob, "base64");
	const hex = "deadbeef".repeat(4);
	assertRedacted(redactSecrets(`digest ${hex} end`), hex, "hex");
});

Deno.test("redactSecrets leaves plain prose untouched", () => {
	const prose = "sprint-02 arch stage decided frontier, outcome merged";
	const out = redactSecrets(prose);
	if (out !== prose) fail(`prose altered: ${JSON.stringify(out)}`);
	if (redactSecrets("") !== "") fail("empty input must stay empty");
});

Deno.test("formatStageSummary redacts secrets in every field", () => {
	const secret = "TEST-FAKE-STAGE-SECRET";
	const text = formatStageSummary(
		"sprint-02",
		"arch",
		`route frontier, api_key=${secret}`,
		`merged, password=${secret}`,
		`feat-mem0, Bearer ${secret}`,
	);
	assertRedacted(text, secret, "formatStageSummary");
	if (!text.includes("sprint-02")) fail(`sprint id lost: ${JSON.stringify(text)}`);
});

Deno.test("buildRecallQuery redacts secrets and keeps scope", () => {
	const secret = "TEST-FAKE-QUERY-SECRET";
	const query = buildRecallQuery(`decisions where api_key=${secret}`, "sprint-02", "arch");
	assertRedacted(query, secret, "buildRecallQuery");
	if (!query.includes("sprint-02") || !query.includes("arch")) {
		fail(`scope lost: ${JSON.stringify(query)}`);
	}
});
