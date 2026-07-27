# Ingest crash + index size — investigation notes

## 1. Crash: `record.message.role` undefined

`src/indexer/indexer.ts` (`ingestLine`, `case "message"`) assumes every
`type: "message"` record has a nested `message: { role, content }`.

Disk survey of `~/.factory/sessions` (876,370 records, 4,047 transcripts):

| shape | count |
| --- | --- |
| nested `message: {role, content}` | 829,968 |
| flat `{role, text}` | 29 |
| permission-verdict record mislabeled `type: "message"` | 1 |

**Flat shape** (13 files, all under `-home-ain3sh-factory-factory-mono-worktrees-*`):

```json
{"type":"message","id":"...","role":"user","text":"# Task Tool Invocation\n...",
 "timestamp":1780521344008,"session_id":"a12e910d-..."}
```

Note `timestamp` is **epoch ms as a number**, not an ISO string.
`parseTimestamp()` only accepts `string | undefined`, so these would silently
lose their timestamp even after the shape fix.

**Verdict record** (1, in `-home-ain3sh-...-review-pr-15350/cb3adbda-...jsonl`):

```json
{"type":"message","id":"...","timestamp":"2026-06-29T23:40:5f6164-...",
 "action":"Allow","command_redacted":"gh api ...","entry_type":"verdict",
 "tier_reached":1,"raw_action":"Allow","raw_rule_ids":[]}
```

No `message`, no `text`, no `role` — a permission audit entry that leaked into
the transcript stream. Must be skipped, not coerced.

Same assumption exists in `src/query/transcript.ts` (`loadTranscript`,
`case "message"`), so the fix belongs in `records.ts` as a shared normalizer.

## 2. Index size: 1.45 GB for 6.0 GB of sessions

`~/.cache/dsx/index.db` = 1,521,233,920 B + 44 MB WAL.

`dbstat` breakdown (MB):

| object | MB |
| --- | --- |
| `blocks_fts_content` | 970 |
| `blocks_fts_data` | 247 |
| `blocks` | 66 |
| `messages` | 53 |
| `idx_blocks_session` | 34 |
| `sqlite_autoindex_messages_1` | 26 |
| `idx_blocks_tooluse` | 20 |
| `idx_messages_day` | 13 |
| `blocks_fts_docsize` | 6 |
| rest | < 10 |

670,510 blocks / 670,487 FTS rows. `sum(full_length)` = 1.21 GB of source text;
840 MB after the 8 KiB per-block cap.

Stored bytes by block type (MB, capped / uncapped): `tool_result` 575/827,
`tool_use` 122/127, `text` 85/145, `thinking` 56/57.

Cap sweep `sum(min(full_length,N))` MB: 512→210, 1k→317, 2k→457, 4k→635, 8k→840.

**`blocks_fts_content` is pure duplication** — the FTS shadow copy of text we
already have verbatim in the source JSONL. It is 64% of the whole DB.

### Measurements backing the fix

- Bun 1.3.14 ships SQLite 3.53.0; `content=''` + `contentless_delete=1`
  verified working (insert → MATCH hit → delete → MATCH miss).
- On-demand source line reads: 100 random `Bun.file().slice(off,off+len).text()`
  reads in **5.4 ms** (~54 µs each). Line lengths p50 1,570 / p95 18,286 /
  p99 55,660 / max 1,220,474.
- zstd level 3 on block text ≈ **2.35x** — worse than just deleting the copy.

Projected after dropping the content + docsize shadows: ~475 MB (−67%).

### Snippet consequence

`snippet(blocks_fts, ...)` (`src/query/search.ts:75`) needs stored content, so
going contentless means generating snippets in TS from the source line.
Consumers: `src/cli/commands/search.ts:100,117` and
`src/tui/views/Search.tsx:39`, both via `renderSnippet` (`src/cli/format.ts:131`),
which turns `\u0001`/`\u0002` sentinels into highlights. Keeping those sentinels
keeps both consumers untouched.

To locate a hit's source line we need its byte offset: `readLines()` already
tracks exact byte consumption, so `messages` gains `byte_offset` / `byte_length`.

`SCHEMA_VERSION` bump triggers `rebuildSchema()` (drop all + re-ingest), so no
hand-written migration is needed — but `DROP TABLE` alone leaves the 1.45 GB
file allocated, so the rebuild must `VACUUM`.

## 3. Implementation surface (file:line, verified)

- `src/indexer/records.ts` — add `normalizeMessage(record)` returning
  `{ role, blocks } | null`. Handles nested, flat `{role,text}`, and returns
  `null` for the verdict record. Also widen `parseTimestamp` to
  `string | number | undefined`.
- `src/indexer/indexer.ts:200` insertMessage, `:203` insertBlock, `:206`
  insertFts, `:222` `case "message"`. `readLines()` (bottom of file) already
  yields `byteLength`; expose the running offset per line to store
  `byte_offset` / `byte_length` on `messages`.
- `src/indexer/db.ts:101` FTS table decl, `SCHEMA_VERSION = 1` at top,
  `rebuildSchema()` at bottom, `openDb()` PRAGMAs (~line 113).
- `src/query/search.ts:75` `snippet(...)` call → replace with TS-side snippet
  built from the source line.
- `src/query/transcript.ts:66` `const role = record.message.role` → normalizer.
- `src/cli/format.ts:128` exports `SNIPPET_OPEN = "\u0001"`,
  `SNIPPET_CLOSE = "\u0002"`, `renderSnippet(snippet, colorize)`.
- Consumers of `SearchHit.snippet`: `src/cli/commands/search.ts:100,117`,
  `src/tui/views/Search.tsx:39`.
- `src/cli/commands/maintenance.ts` — `dsx index [--rebuild]` action; good place
  to add `VACUUM` after a rebuild and report DB size.
- `src/context.ts` — `createContext()` wires `openDb` + `Indexer`.
- Tests: `tests/fixtures.ts` (`makeFixture`, exports `SESSION_*`),
  `tests/indexer.test.ts` (`describe("indexing")`, `describe("queries")` with
  `full-text search finds thinking and tool output`).
- `bun test`, `bunx tsc --noEmit`, `bun run build`, `bun run compile` per AGENTS.md.
- Skill docs to update when CLI surface changes: `.agents/skills/dsx/SKILL.md`
  and `.agents/skills/dsx/references/*.md`.

## 4. Outcome (verified 2026-07-27)

Implemented and verified on the real store (6,262 files / 877,439 lines):

| metric | before (crashed, partial) | after (full) |
| --- | --- | --- |
| blocks | 670,510 | 1,261,112 |
| messages | 504,908 | 830,993 |
| indexed text | 1,158 MB | 2,307 MB |
| **index.db** | **1,521 MB** | **949 MB** |
| **bytes/block** | **2,270** | **752** (3.0x denser) |

`blocks_fts_content` (970 MB) and `blocks_fts_docsize` are gone; the largest
object is now `blocks_fts_data` at 477 MB. WAL self-checkpointed to 41 KB.

Full reindex: 6m44s. Search latency at `-n 50`: 264-398 ms, 0 empty snippets
out of 50. Highlighting verified against real queries.

`show`/`export` on the formerly-crashing flat-shape session
(`a12e910d-...`) now renders, with epoch-ms timestamps resolving correctly
(2026-06-03T21:15:44.008Z).

### Design notes

- `normalizeMessage()` in records.ts is the single place that understands the
  record variants; indexer.ts and transcript.ts both call it. Returns `null`
  for verdict records so they are skipped rather than coerced.
- `blockText()` is shared by the indexer (what to tokenize) and search (what to
  snippet), so the two can never drift.
- Snippets: `matchTerms()` extracts bare words from the FTS query (dropping
  AND/OR/NOT/NEAR and punctuation), then `buildSnippet()` windows +/-24 words
  around the first hit and wraps matches in `\u0001`/`\u0002` — the same
  sentinels `renderSnippet()` already consumed, so CLI and TUI were untouched.
- Both rebuild paths VACUUM: `Indexer.rebuild()` and `rebuildSchema()` on
  version bump. Without it the freed pages stay allocated to the file.
- Stemming caveat: FTS matches on porter stems, so a hit whose only match is a
  stem variant (search "running", text "runs") shows an unhighlighted snippet
  rather than a wrong one. Substring matching on terms covers the common cases.

## 5. Status / remaining

Files changed:
- `src/indexer/records.ts` — MessageRecord union, normalizeMessage, blockText,
  parseTimestamp accepts number
- `src/indexer/indexer.ts` — SourceLine byte spans, normalizeMessage, BLOCK_TYPES,
  VACUUM in rebuild()
- `src/indexer/db.ts` — SCHEMA_VERSION 2, contentless FTS, byte_offset/byte_length,
  VACUUM in rebuildSchema()
- `src/query/search.ts` — matchTerms/buildSnippet/readSnippet, JOIN messages
- `src/query/transcript.ts` — normalizeMessage
- `tests/fixtures.ts` — SESSION_FLAT + addFlatMessageSession
- `tests/indexer.test.ts` — 4 new tests

Verified: `bun test` 40 pass, `bunx tsc --noEmit` clean, `bun run build`,
`bun run compile` + CLI smoke, full reindex, CLI search, show/export on the
formerly-crashing session, TUI dashboard renders under tuistory.

Remaining: TUI search-results snippet visual check, close tuistory session
`dsxtui`, confirm no dsx skill doc changes needed (no CLI surface change:
same commands/flags/JSON shapes), commit.

### TUI search note (tuistory)

`src/tui/views/Search.tsx` renders hits via `renderSnippet(h.snippet, false)`
(line ~39), reading `SearchHit.snippet` — the same field the CLI uses, so the
new source-backed snippets flow through unchanged with no TUI edit needed.

tuistory could not drive the search box reliably: `type` into the input did not
register (search stayed "0 hits"), and pressing `3` from the dashboard jumped
straight into a transcript view. The dashboard render and clean launch were
confirmed; TUI search snippets are covered by the CLI path + unit tests
(`searchBlocks` is shared verbatim between CLI and TUI).
