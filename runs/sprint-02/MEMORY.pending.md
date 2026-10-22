# MEMORY.pending — sprint-02 (mem0 write blocked, flush when service heals)

## Diagnosis (2026-10-22)

- Read path OK: `POST /search` → 200, `GET /memories` → 200.
- Write path broken: `POST /memories` → `502 {"detail":"Upstream provider error.","code":"unknown","request_id":"31df96c0"}`.
- Cause: mem0-cloud's upstream LLM (memory extraction) unreachable — server-side,
  likely key/quota/config on the mem0 service itself. Not our bridge, not auth
  (same key reads fine).

## Queued writes (flush with run_id preserved)

1. run_id `sprint-02`: pi-pipeline sprint-02 dogfood (closed): mem0 hooks + deno tests
   64/64 + recovery in code via live dispatch, review bridge/sonnet merge-after-fix
   (4 must-fix incl. real duplicate-create bug, all fixed), merged to master.
   Learnings: parallel ownership of one file tears (freeze API or single owner);
   worker rebase = coordinator job; add/add conflicts resolved to review-approved side.
