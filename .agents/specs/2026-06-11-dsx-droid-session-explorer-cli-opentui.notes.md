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

## 2026-06-11T08:20Z — dist bundling strategy for the Solid TUI
**Type**: tradeoff
**Context**: Two build bugs: (1) `banner` option duplicated the source shebang producing invalid JS; (2) `packages: "external"` left solid-js unresolved at runtime, so Bun picked its SSR build (dist/server.js) and the TUI crashed. The opentui solid plugin redirects server.js to the client build via onLoad, which only runs for bundled modules.
**Resolution**: build.ts bundles solid-js + @opentui/solid (plugin redirect applies) and keeps @opentui/core, commander, picocolors external. Shebang comes from src/index.ts, no banner.

## 2026-06-11T08:30Z — Deferred TUI view switches by one tick
**Type**: surprise
**Context**: Pressing a view hotkey (e.g. "3") delivered the same keypress into the freshly-mounted focused input of the new view ("3retry loop" in the search box).
**Resolution**: state.setView/back wrap the actual view swap in setTimeout(0) so mounting happens after the triggering key event completes.

## 2026-06-11T08:35Z — span styling uses style prop, not fg/bg props
**Type**: surprise
**Context**: @opentui/solid 0.4.0's reconciler only honors `style={{fg,bg}}` on TextNode spans (direct fg prop is silently ignored and also not in SpanProps types).
**Resolution**: All spans use style objects; `<text fg=...>` remains valid since TextRenderable options include fg.

## 2026-06-11T07:45Z — Verified JSONL schema against factory-mono source
**Type**: decision
**Context**: packages/common/src/session/jsonl/types.ts defines DroidSessionEvent union; matches the implemented parser. Extra block types exist (image, redacted_thinking, document) and DroidMessageEvent.tokens exists but is never populated in local files (verified by rg over all sessions).
**Resolution**: Parser skips unknown block types; per-message tokens not indexed. Daily token attribution stays pro-rated from session totals by assistant-message activity.

## 2026-06-12T06:40Z — Factory stream-jsonrpc envelope is not bare JSON-RPC 2.0
**Type**: surprise
**Context**: `droid exec --input-format stream-jsonrpc` rejects standard JSON-RPC requests with `-32700 Invalid JSON-RPC message` (response has `id: null`). The Factory envelope additionally requires `type: "request" | "response" | "notification"`, string `id`s (not numbers), and the legacy literal `factoryApiVersion: "1.0.0"` (see Factory-AI/droid-sdk-typescript src/protocol/json-rpc.ts). Model/reasoning/autonomy go in `droid.initialize_session` params (`modelId`, `reasoningEffort`, `autonomyLevel`, `interactionMode`), not CLI flags. Turn completion = `droid_working_state_changed` to `idle` after at least one non-idle state.
**Resolution**: src/exec/droid.ts sends the full envelope, answers `droid.request_permission` with `cancel` and `droid.ask_user` with `cancelled: true` (unattended runs), and gates turn-resolution on the busy→idle transition.

## 2026-06-12T06:45Z — droid exec sessions auto-tag `exec`
**Type**: decision
**Context**: Verified in the index: all stream-jsonrpc/exec-spawned sessions carry the `exec` tag (often plus `subagent`), so the indexer's `is_exec` flag already excludes dsx's own deep-insights runs from list/insights reports. No recursion guard needed.
**Resolution**: Deep-insights runs add a `dsx-insights` tag on top for traceability; cache lives in the meta table under `deep_insights`.

## 2026-06-12T06:50Z — expensive signal was relative but incommensurable
**Type**: decision
**Context**: The old `expensive` severity (`credits/median/100`) produced values in the thousands while every other signal sat in [0,1]; after the global severity sort, the ~5% p95+ sessions blanketed the findings list. The relativity (p95 of the user's own sessions) was never the bug.
**Resolution**: All severities clamped to [0,1]; expensive = log10(credits/median)/3 over positive-credit sessions with threshold max(p95, 3x median) and a 20-session minimum sample; details cite median-ratio + percentile; without --kind each kind caps at 10 findings.

## 2026-06-12T07:20Z — Input focus hand-off leaks the triggering keypress both ways
**Type**: surprise
**Context**: Same root cause as the deferred view switches: focusing an `<input>` synchronously inside useKeyboard delivers the triggering key into the input ("pvfs"), and unfocusing synchronously on enter/escape delivers the closing key to the re-focused `<select>` behind it (opened a transcript) or the global handler (escape navigated back).
**Resolution**: Insights and Sessions defer both the focus grant and the focus release with setTimeout(0); inputActive is cleared inside the same deferred callback so the global handler still sees it as active during the closing event.
