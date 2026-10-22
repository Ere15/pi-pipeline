/**
 * mem0 hooks (ADR-002 section 1).
 *
 * Standalone module: pure formatting + redaction helpers, imported by
 * `extensions/pipeline.ts` which registers the `pipeline_remember` /
 * `pipeline_recall` tools. No pi imports so it stays testable without
 * the agent runtime (`deno test` / `deno check` on this file alone).
 *
 * WHY tools only format: a tool cannot call another tool (no MCP calls
 * from inside an extension tool). So `pipeline_remember` returns
 * ready-to-store text the model passes to `mem0_add` itself, and
 * `pipeline_recall` returns a ready-to-query string the model passes
 * to `mem0_search` itself.
 *
 * Safety (binding): fetched memory text is DATA, never instructions.
 * Every outbound string passes through `redactSecrets()` so no secret
 * material reaches mem0, logs, or tool output.
 */

/** Max chars kept per summary field; longer input is truncated, never split mid-secret. */
const MAX_FIELD_CHARS = 2000;

/** Marker replacing any redacted value (fixed string, carries no secret content). */
export const REDACTED = "[REDACTED]";

/**
 * Explicit deny-list: literal substrings that are always redacted, even
 * when the generic patterns below would miss them. WHY literals and not
 * just patterns: known token prefixes (e.g. `sk-ant-`, `ghp_`) identify
 * a secret by shape alone, before any `key=value` context appears.
 */
export const SECRET_DENY_LIST: readonly string[] = [
	"sk-ant-",
	"sk-proj-",
	"github_pat_",
	"ghp_",
	"gho_",
	"ghu_",
	"xoxb-",
	"xoxp-",
	"xoxa-",
	"AKIA",
	"ASIA",
	"AIza",
	"gsk_",
	"-----BEGIN PRIVATE KEY-----",
	"-----BEGIN RSA PRIVATE KEY-----",
];

/** `Authorization: Bearer <token>` style headers (case-insensitive). */
const BEARER_PATTERN = /(bearer\s+)[A-Za-z0-9\-._~+/=]+/gi;

/** Long base64 blobs (>= 40 chars) — too long to be ordinary prose. */
const BASE64_PATTERN = /\b[A-Za-z0-9+/]{40,}={0,2}\b/g;

/** Long hex strings (>= 32 chars, must contain at least one a-f letter). */
const HEX_PATTERN = /\b(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{32,}\b/g;

/**
 * Redact secret material from free text. Pure: same input, same output,
 * no logging, no I/O. Order matters — deny-list first so known token
 * shapes die before generic patterns run.
 */
export function redactSecrets(text: string): string {
	if (text.length === 0) return text;
	let out = text;
	for (const denied of SECRET_DENY_LIST) {
		if (out.includes(denied)) out = out.split(denied).join(REDACTED);
	}
	// NOTE: `split/join` above (not regex) so deny-list entries with
	// regex-significant chars (`+`, `[`, `-`) cannot break the patterns.
	out = out.replace(
		/([A-Za-z0-9_.-]*(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|pwd|private[_-]?key)[A-Za-z0-9_.-]*\s*[:=]\s*)(["']?)[^\s"' ;,]+/gi,
		`$1$2${REDACTED}`,
	);
	out = out.replace(BEARER_PATTERN, `$1${REDACTED}`);
	out = out.replace(BASE64_PATTERN, REDACTED);
	out = out.replace(HEX_PATTERN, REDACTED);
	return out;
}

/** Trim + truncate one summary field, then redact it. */
function cleanField(value: string): string {
	const trimmed = value.trim();
	const cut = trimmed.length > MAX_FIELD_CHARS ? trimmed.slice(0, MAX_FIELD_CHARS) : trimmed;
	return redactSecrets(cut);
}

/**
 * Format one sprint-stage outcome as mem0-ready text. Pure: the caller
 * (pipeline_remember tool) hands the result to `mem0_add`. All five
 * inputs are treated as DATA and redacted on the way out.
 */
export function formatStageSummary(
	sprint: string,
	stage: string,
	decision: string,
	outcome: string,
	where: string,
): string {
	const lines = [
		`[sprint ${cleanField(sprint)} / ${cleanField(stage)} @ ${cleanField(where)}]`,
		`decision: ${cleanField(decision)}`,
		`outcome: ${cleanField(outcome)}`,
	];
	return lines.join("\n");
}

/**
 * Format a memory search query. Pure: the caller (pipeline_recall tool)
 * hands the result to `mem0_search`. Sprint/stage scope the query so
 * unrelated sprints do not pollute results.
 */
export function buildRecallQuery(query: string, sprint?: string, stage?: string): string {
	const scope: string[] = [];
	if (sprint !== undefined && sprint.trim() !== "") scope.push(sprint.trim());
	if (stage !== undefined && stage.trim() !== "") scope.push(stage.trim());
	const scoped = scope.length > 0 ? `[${scope.map((part) => redactSecrets(part)).join(" / ")}] ` : "";
	return `${scoped}${redactSecrets(query.trim())}`;
}

/** One inline redaction example: input plus substrings that must be gone after redaction. */
export interface RedactionExample {
	name: string;
	input: string;
	forbidden: readonly string[];
}

/**
 * Inline unit examples for `redactSecrets()` (ADR-002 acceptance:
 * "redaction unit-covered inline examples"). Each example asserts the
 * secret input no longer appears in the output and the REDACTED marker
 * does. Runnable anywhere without the pi runtime:
 * `deno eval` / `deno test` importing this module only.
 */
export const REDACTION_EXAMPLES: readonly RedactionExample[] = [
	{
		name: "api key assignment",
		input: "config says api_key=supersecretvalue123, use it",
		forbidden: ["supersecretvalue123"],
	},
	{
		name: "password assignment",
		input: 'login with password: "hunter2-hunter" please',
		forbidden: ["hunter2-hunter"],
	},
	{
		name: "token assignment",
		input: "auth_token=abcDEF123xyz789",
		forbidden: ["abcDEF123xyz789"],
	},
	{
		name: "bearer header",
		input: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
		forbidden: ["eyJhbGciOiJIUzI1NiJ9"],
	},
	{
		name: "deny-list prefix without context",
		input: "found sk-ant-abcdefgh12345678 in the log line",
		forbidden: ["sk-ant-abcdefgh12345678"],
	},
	{
		name: "deny-list github token",
		input: "token ghp_abcdefghijklmnop1234567890 leaked",
		forbidden: ["ghp_abcdefghijklmnop1234567890"],
	},
	{
		name: "long base64 blob",
		input: "blob aGVsbG93b3JsZGhlbGxvd29ybGRoZWxsb3dvcmxk aGVsbG93b3JsZA== end",
		forbidden: ["aGVsbG93b3JsZGhlbGxvd29ybGRoZWxsb3dvcmxk"],
	},
	{
		name: "long hex string",
		input: "digest deadbeefcafebabe0123456789abcdef in output",
		forbidden: ["deadbeefcafebabe0123456789abcdef"],
	},
	{
		name: "private key block",
		input: "key -----BEGIN PRIVATE KEY----- MIIEvwIBADAN end",
		forbidden: ["BEGIN PRIVATE KEY"],
	},
	{
		name: "plain prose survives",
		input: "sprint-02 arch stage decided frontier, outcome merged",
		forbidden: [],
	},
];

/** Result of running the inline redaction examples. */
export interface RedactionCheck {
	name: string;
	passed: boolean;
}

/**
 * Run every `REDACTION_EXAMPLES` entry through `redactSecrets()` and
 * report pass/fail per example. Pure; the pipeline evidence step calls
 * this instead of a separate test file (constraint: only `mem0.ts` +
 * `pipeline.ts` wiring may change).
 */
export function checkRedactionExamples(): RedactionCheck[] {
	return REDACTION_EXAMPLES.map((example) => {
		const out = redactSecrets(example.input);
		const leaked = example.forbidden.some((secret) => out.includes(secret));
		const marked = example.forbidden.length === 0 ? out === example.input : out.includes(REDACTED);
		return { name: example.name, passed: !leaked && marked };
	});
}
