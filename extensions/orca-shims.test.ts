/**
 * orca-shims behavior tests (ADR-002 section 2).
 *
 * WHY a fake `orca` on PATH: the shims spawn the CLI as a child process,
 * so response parsing and error mapping run against canned stdout/stderr
 * instead of live worktrees. Fetched message text is DATA, never executed.
 * This file imports only the pure shims module — no pi runtime.
 *
 * Canonical runner (spawning the fake CLI needs subprocess/env/file
 * permissions, which Deno.test can only restrict, never grant):
 *   deno test --allow-env --allow-run --allow-read --allow-write extensions/
 */

import { ok, strictEqual } from "node:assert/strict";
import {
	type OrcaError,
	checkMessages,
	createTerminal,
	createWorktree,
	dispatchTask,
	releaseWorker,
	replyToMessage,
} from "./orca-shims.ts";

/** Grants the subprocess/env/file access these tests need to run bare. */
const PERMS = { env: true, run: true, read: true, write: true } as const;

/**
 * Wraps a script body with argv logging. WHY the guard: most tests do not
 * set FAKE_ORCA_LOG, and an unguarded redirect to "" would fail noisily.
 */
function sh(body: string): string {
	return `#!/bin/sh\n[ -n "$FAKE_ORCA_LOG" ] && echo "$@" >> "$FAKE_ORCA_LOG"\n${body}`;
}

/** Fake `orca` that prints one JSON payload. Payloads avoid single quotes. */
function jsonScript(payload: string): string {
	return sh(`printf '%s' '${payload}'\n`);
}

/** Fake `orca` that fails with stderr text and exit code 1. */
function failScript(stderrText: string): string {
	return sh(`printf '%s\\n' '${stderrText}' >&2\nexit 1\n`);
}

/**
 * Installs `script` as an executable `orca` on a temp PATH dir, runs `fn`,
 * then restores PATH and cleans up. Set `isolated` to hide the real PATH
 * (drives the CLI-missing branch).
 */
async function withFakeOrca(
	script: string,
	fn: (dir: string) => Promise<void>,
	isolated = false,
): Promise<void> {
	const dir = await Deno.makeTempDir({ prefix: "orca-fake-" });
	try {
		await Deno.writeTextFile(`${dir}/orca`, script);
		await Deno.chmod(`${dir}/orca`, 0o755);
		const prev = Deno.env.get("PATH") ?? "";
		Deno.env.set("PATH", isolated ? dir : `${dir}:${prev}`);
		try {
			await fn(dir);
		} finally {
			Deno.env.set("PATH", prev);
		}
	} finally {
		await Deno.remove(dir, { recursive: true });
	}
}

function recordTo(dir: string): { log: string; count: string } {
	return { log: `${dir}/argv.log`, count: `${dir}/count` };
}

/** Flaky fake: first call fails with `firstStderr`, later calls succeed. */
function flakyScript(firstStderr: string, secondPayload: string): string {
	return `#!/bin/sh
[ -n "$FAKE_ORCA_LOG" ] && echo "$@" >> "$FAKE_ORCA_LOG"
n=$(cat "$FAKE_ORCA_COUNT" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$FAKE_ORCA_COUNT"
if [ "$n" -eq 1 ]; then
  printf '%s\\n' '${firstStderr}' >&2
  exit 1
fi
printf '%s' '${secondPayload}'
`;
}

function retryIds(logText: string): string[] {
	return logText
		.trim()
		.split("\n")
		.map((line) => line.match(/--retry-request (\S+)/)?.[1] ?? "");
}

// createWorktree: response parsing and error mapping.

Deno.test({
	name: "worktree create returns the id and name from the response",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript('{"id":"w-1","name":"alpha"}'), async () => {
			const result = await createWorktree({ name: "alpha" });
			ok(result.ok);
			strictEqual(result.data.id, "w-1");
			strictEqual(result.data.name, "alpha");
		});
	},
});

Deno.test({
	name: "worktree create accepts the id alias and falls back to the requested name",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript('{"worktreeId":"w-9"}'), async () => {
			const result = await createWorktree({ name: "asked" });
			ok(result.ok);
			strictEqual(result.data.id, "w-9");
			strictEqual(result.data.name, "asked");
		});
	},
});

Deno.test({
	name: "worktree create reports a missing id instead of inventing one",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript('{"name":"x"}'), async () => {
			const result = await createWorktree({ name: "x" });
			ok(!result.ok);
			strictEqual((result.error as OrcaError).detail, "worktree failed: response missing worktree id");
		});
	},
});

Deno.test({
	name: "worktree create maps a missing target to a short error",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(failScript("worktree not found: wt-1"), async () => {
			const result = await createWorktree({ name: "wt-1" });
			ok(!result.ok);
			strictEqual((result.error as OrcaError).detail, "worktree failed: target not found");
		});
	},
});

Deno.test({
	name: "worktree create maps timeout wording without leaking stderr",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(failScript("upstream timeout after 30s"), async () => {
			const result = await createWorktree({ name: "wt-1" });
			ok(!result.ok);
			ok(!(result.error as OrcaError).detail.includes("upstream timeout"));
			strictEqual((result.error as OrcaError).code, "ORCA_TIMEOUT");
			ok((result.error as OrcaError).retryable);
			strictEqual(
				(result.error as OrcaError).detail,
				"worktree timed out: retry with same retry-request id",
			);
		});
	},
});

Deno.test({
	name: "worktree create retries a lost reply under the same retry-request id",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(flakyScript("socket hang up", '{"id":"w-2"}'), async (dir) => {
			const { log, count } = recordTo(dir);
			Deno.env.set("FAKE_ORCA_LOG", log);
			Deno.env.set("FAKE_ORCA_COUNT", count);
			try {
				const result = await createWorktree({ name: "wt-1" });
				ok(result.ok);
				strictEqual(result.data.id, "w-2");
				strictEqual(await Deno.readTextFile(count), "2\n");
			} finally {
				Deno.env.delete("FAKE_ORCA_LOG");
				Deno.env.delete("FAKE_ORCA_COUNT");
			}
		});
	},
});

Deno.test({
	name: "worktree create reports an unavailable CLI instead of a spawn stack",
	permissions: PERMS,
	fn: async () => {
		// No fake installed and the real PATH hidden: spawn fails with ENOENT.
		const dir = await Deno.makeTempDir({ prefix: "orca-empty-" });
		const prev = Deno.env.get("PATH") ?? "";
		Deno.env.set("PATH", dir);
		try {
			const result = await createWorktree({ name: "wt-1" });
			ok(!result.ok);
			strictEqual((result.error as OrcaError).detail, "orca unavailable: CLI not installed");
		} finally {
			Deno.env.set("PATH", prev);
			await Deno.remove(dir, { recursive: true });
		}
	},
});

// createTerminal: response parsing.

Deno.test({
	name: "terminal create returns the handle from the response",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript('{"handle":"term-1"}'), async () => {
			const result = await createTerminal({});
			ok(result.ok);
			strictEqual(result.data.handle, "term-1");
		});
	},
});

Deno.test({
	name: "terminal create reports a missing handle instead of inventing one",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript("{}"), async () => {
			const result = await createTerminal({});
			ok(!result.ok);
			strictEqual((result.error as OrcaError).code, "ORCA_BAD_RESPONSE");
			strictEqual(
				(result.error as OrcaError).detail,
				"terminal failed: response missing terminal handle",
			);
		});
	},
});

// dispatchTask: response parsing, retry, and error mapping.

Deno.test({
	name: "dispatch returns the dispatch id from the response",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript('{"dispatchId":"d-1"}'), async () => {
			const result = await dispatchTask({ taskId: "t-1", to: "term-1" });
			ok(result.ok);
			strictEqual(result.data.dispatchId, "d-1");
		});
	},
});

Deno.test({
	name: "dispatch accepts the id alias",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript('{"id":"d-2"}'), async () => {
			const result = await dispatchTask({ taskId: "t-1", to: "term-1" });
			ok(result.ok);
			strictEqual(result.data.dispatchId, "d-2");
		});
	},
});

Deno.test({
	name: "dispatch reports a missing dispatch id instead of inventing one",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript('{"ok":true}'), async () => {
			const result = await dispatchTask({ taskId: "t-1", to: "term-1" });
			ok(!result.ok);
			strictEqual((result.error as OrcaError).detail, "dispatch failed: response missing dispatch id");
		});
	},
});

Deno.test({
	name: "dispatch retries a lost reply once with the same retry-request id",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(flakyScript("socket hang up", '{"dispatchId":"d-7"}'), async (dir) => {
			const { log, count } = recordTo(dir);
			Deno.env.set("FAKE_ORCA_LOG", log);
			Deno.env.set("FAKE_ORCA_COUNT", count);
			try {
				const result = await dispatchTask({ taskId: "t-1", to: "term-1" });
				ok(result.ok);
				strictEqual(result.data.dispatchId, "d-7");
				strictEqual(await Deno.readTextFile(count), "2\n");
				const ids = retryIds(await Deno.readTextFile(log));
				strictEqual(ids.length, 2);
				ok(ids[0].length > 0);
				strictEqual(ids[0], ids[1]);
			} finally {
				Deno.env.delete("FAKE_ORCA_LOG");
				Deno.env.delete("FAKE_ORCA_COUNT");
			}
		});
	},
});

Deno.test({
	name: "dispatch sends a caller-supplied retry-request id",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript('{"dispatchId":"d-3"}'), async (dir) => {
			const { log } = recordTo(dir);
			Deno.env.set("FAKE_ORCA_LOG", log);
			try {
				const result = await dispatchTask({
					taskId: "t-1",
					to: "term-1",
					retryRequest: "fixed-req-1",
				});
				ok(result.ok);
				ok((await Deno.readTextFile(log)).includes("--retry-request fixed-req-1"));
			} finally {
				Deno.env.delete("FAKE_ORCA_LOG");
			}
		});
	},
});

Deno.test({
	name: "dispatch does not retry a definitive error",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(flakyScript("task not found: t-9", '{"dispatchId":"d-9"}'), async (dir) => {
			const { count } = recordTo(dir);
			Deno.env.set("FAKE_ORCA_COUNT", count);
			try {
				const result = await dispatchTask({ taskId: "t-9", to: "term-1" });
				ok(!result.ok);
				strictEqual((result.error as OrcaError).detail, "dispatch failed: target not found");
				strictEqual(await Deno.readTextFile(count), "1\n");
			} finally {
				Deno.env.delete("FAKE_ORCA_COUNT");
			}
		});
	},
});

Deno.test({
	name: "dispatch maps unknown failures to a short error that hides stderr secrets",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(failScript("kaboom ref=sk-SECRET-99"), async () => {
			const result = await dispatchTask({ taskId: "t-1", to: "term-1" });
			ok(!result.ok);
			strictEqual((result.error as OrcaError).code, "ORCA_UNKNOWN");
			ok(!(result.error as OrcaError).detail.includes("SECRET-99"));
		});
	},
});

// checkMessages: response parsing and error mapping.

Deno.test({
	name: "check wraps a bare array envelope in messages",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript('[{"a":1}]'), async () => {
			const result = await checkMessages({});
			ok(result.ok);
			strictEqual(result.data.messages.length, 1);
		});
	},
});

Deno.test({
	name: "check keeps an object envelope with its messages",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript('{"messages":[{"a":1}],"cursor":"c"}'), async () => {
			const result = await checkMessages({});
			ok(result.ok);
			strictEqual(result.data.messages.length, 1);
			strictEqual((result.data as Record<string, unknown>)["cursor"], "c");
		});
	},
});

Deno.test({
	name: "check reports empty stdout instead of parsing it",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(sh("exit 0\n"), async () => {
			const result = await checkMessages({});
			ok(!result.ok);
			strictEqual((result.error as OrcaError).detail, "check failed: empty response from orca");
		});
	},
});

Deno.test({
	name: "check reports invalid JSON instead of guessing",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(sh("printf '%s' 'not json {'\n"), async () => {
			const result = await checkMessages({});
			ok(!result.ok);
			strictEqual((result.error as OrcaError).detail, "check failed: unreadable response from orca");
		});
	},
});

Deno.test({
	name: "check maps nothing-to-act-on to a short error",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(failScript("no dispatch bound for terminal"), async () => {
			const result = await checkMessages({});
			ok(!result.ok);
			strictEqual((result.error as OrcaError).detail, "check failed: nothing to act on");
		});
	},
});

// replyToMessage: response parsing and error mapping.

Deno.test({
	name: "reply returns the message id from the response",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript('{"messageId":"m-1"}'), async () => {
			const result = await replyToMessage({ id: "q-1", body: "hi" });
			ok(result.ok);
			strictEqual(result.data.messageId, "m-1");
		});
	},
});

Deno.test({
	name: "reply reports a missing message id instead of inventing one",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript("{}"), async () => {
			const result = await replyToMessage({ id: "q-3", body: "hi" });
			ok(!result.ok);
			strictEqual((result.error as OrcaError).code, "ORCA_BAD_RESPONSE");
			strictEqual(
				(result.error as OrcaError).detail,
				"reply failed: response missing message id",
			);
		});
	},
});

Deno.test({
	name: "reply maps permission failures to a short error",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(failScript("permission denied for reply"), async () => {
			const result = await replyToMessage({ id: "q-1", body: "hi" });
			ok(!result.ok);
			strictEqual((result.error as OrcaError).detail, "reply failed: permission denied");
		});
	},
});

// releaseWorker: idempotent release mapping.

Deno.test({
	name: "release returns the status from the response",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(jsonScript('{"status":"released"}'), async () => {
			const result = await releaseWorker({ dispatchId: "d-1" });
			ok(result.ok);
			strictEqual(result.data.status, "released");
		});
	},
});

Deno.test({
	name: "release maps already-released to success instead of an error",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(failScript("dispatch d-1 already_released"), async () => {
			const result = await releaseWorker({ dispatchId: "d-1" });
			ok(result.ok);
			strictEqual(result.data.status, "already_released");
		});
	},
});

Deno.test({
	name: "release maps invalid arguments to a short error",
	permissions: PERMS,
	fn: async () => {
		await withFakeOrca(failScript("invalid arguments (usage: orca release)"), async () => {
			const result = await releaseWorker({ dispatchId: "d-1" });
			ok(!result.ok);
			strictEqual((result.error as OrcaError).detail, "release failed: invalid arguments");
		});
	},
});
