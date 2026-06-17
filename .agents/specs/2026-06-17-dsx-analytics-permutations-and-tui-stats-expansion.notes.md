# Implementation Notes — 2026-06-17-dsx-analytics-permutations-and-tui-stats-expansion

Spec: 2026-06-17-dsx-analytics-permutations-and-tui-stats-expansion.md
Approved: 2026-06-16T19:50:49-07:00
User comment: you should use droid-control for TUI verification when appropriate!

---

## 2026-06-16T19:54:54-07:00 — Segment view always includes hidden buckets
**Type**: decision
**Context**: The spec called for default stats to exclude subagent/exec sessions, but also wanted a segment view to explain what the default scope excludes. If `bySegment` inherited the default filters, it would only show `main`.
**Resolution**: `bySegment` forces `includeSubagents` and `includeExec` while still honoring project/model/date filters. The alternative was requiring `stats --by segment --all`, but that makes the explanatory view easy to misread.

## 2026-06-16T19:56:27-07:00 — Split interpreting docs by concern
**Type**: decision
**Context**: The implementation added stats cross-tab semantics to `interpreting.md`, making that reference a mix of cost caveats, analytics math, and insights rules.
**Resolution**: Kept `interpreting.md` as a small router and moved details into `usage-semantics.md`, `stats-analytics.md`, and `insights.md`. The alternative was appending more sections to one file, but that would make future skill loading less precise.

## 2026-06-16T19:57:13-07:00 — Absorb the empty interpreting router
**Type**: deviation
**Context**: After splitting details into atomic references, `interpreting.md` only routed readers to files already listed in the parent skill. Keeping it would add an extra hop with no content.
**Resolution**: Removed `interpreting.md`, listed focused references directly in `SKILL.md`, and embedded the focused files in the dsx sub-droid cheatsheet. The alternative was keeping a near-empty router for compatibility, but the user explicitly did not want legacy compatibility here.

## 2026-06-16T19:59:07-07:00 — Source TUI launch command needs preload before file
**Type**: surprise
**Context**: The first droid-control TUI verification used `bun --preload ... run src/index.ts`, which Bun treated as invalid `bun run` usage rather than launching the TUI.
**Resolution**: Discarded that capture as non-evidence and reran verification with `bun --preload @opentui/solid/preload src/index.ts --no-refresh tui`. The alternative was using the failed artifact anyway, but it only proved command misuse.

## 2026-06-16T20:01:54-07:00 — Daily usage rows carry pro-rated tool metrics
**Type**: tradeoff
**Context**: TUI metric cycling and CLI `--metric` include tool/error metrics, but the first daily group query only returned token and credit fields. That made some metric selections render as zeroes.
**Resolution**: Added pro-rated `activeTimeMs`, `toolCalls`, and `toolErrors` to daily and grouped usage rows, using the same assistant-message weighting as tokens/credits. The alternative was rejecting unsupported metrics per view, but that would make the TUI metric cycle inconsistent and less useful.

## 2026-06-16T20:03:44-07:00 — Split analytics assertions into atomic tests
**Type**: decision
**Context**: The initial query coverage put day-group, tool-matrix, segment, and distribution assertions in one broad test. The over-coverage pass found that each invariant had the same owning integration suite but separate failure modes.
**Resolution**: Split the assertions into focused tests inside `tests/indexer.test.ts`. The alternative was keeping one broad smoke test, but that made regressions less local and violated the requested atomicity.
