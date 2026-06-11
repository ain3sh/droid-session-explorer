# Implementation Notes — 2026-06-11-dsx-droid-session-explorer-cli-opentui

Spec: 2026-06-11-dsx-droid-session-explorer-cli-opentui.md
Approved: 2026-06-11
User comment: push as powerfully as you'd like, I'm excited to see where your instincts take you! I can always help you refine after the fact <3

---

## 2026-06-11T07:05Z — FTS5 external-content replaced with regular FTS table
**Type**: deviation
**Context**: Spec said FTS5 with external content on a blocks table. External-content and contentless FTS tables require the special 'delete' insert command for row removal, which makes purge/reindex of a session awkward.
**Resolution**: blocks table holds metadata only; blocks_fts is a regular FTS5 table whose rowid mirrors blocks.id and stores the (capped) text. Plain DELETE works; snippet() still available. Content capped at 8KB/block since full content is always re-readable from source JSONL.

## 2026-06-11T07:10Z — Index DB stores no full transcripts
**Type**: decision
**Context**: 3.3GB of session data; indexing full tool outputs would multiply disk usage.
**Resolution**: Transcript viewer/exporter always re-parses the source JSONL (loadTranscript). The DB is a search/stats index, not a mirror. Regex search delegates to ripgrep over source files instead of SQL.

## 2026-06-11T07:40Z — bunfig.toml preload removed
**Type**: surprise
**Context**: bunfig.toml `preload = ["@opentui/solid/preload"]` is read by ANY bun process started in the repo dir, which broke running `droid --help` from this directory (droid is bun-based and failed with "preload not found").
**Resolution**: Deleted bunfig.toml. Dev script uses `bun --preload @opentui/solid/preload`; distribution bundle is pre-transformed by the solid bun-plugin so runtime needs no preload.

## 2026-06-11T07:45Z — Verified JSONL schema against factory-mono source
**Type**: decision
**Context**: packages/common/src/session/jsonl/types.ts defines DroidSessionEvent union; matches the implemented parser. Extra block types exist (image, redacted_thinking, document) and DroidMessageEvent.tokens exists but is never populated in local files (verified by rg over all sessions).
**Resolution**: Parser skips unknown block types; per-message tokens not indexed. Daily token attribution stays pro-rated from session totals by assistant-message activity.
