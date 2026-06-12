---
name: dsx
description: Search and analyze past Factory Droid sessions with the dsx CLI. Use when the user asks about previous sessions, past work, token/credit usage, "how did I solve X before", session history, resuming old sessions, or analyzing droid usage patterns.
---

# dsx: Droid Session Explorer

`dsx` indexes every local droid session (`~/.factory/sessions`) into a fast
SQLite+FTS5 index: full transcripts, token usage, tool calls, fork/subagent
lineage, and the user's prompt history.

The index auto-refreshes before every command (sub-second). Add `--no-refresh`
to skip the check when running many commands in a row.

## Core commands

Every command supports `--json` for stable machine-readable output. Prefer it.

```bash
# find sessions
dsx list --json -n 50                       # newest first
dsx list --project vfs --since 7d --json    # filters: --model --min-credits --all
dsx list -q "auth refactor" --json          # fuzzy title match
dsx list --sort credits -n 10 --json        # most expensive sessions

# full-text search inside transcripts (FTS5: "exact phrase", AND, OR, NOT, NEAR(a b, 5))
dsx search "race condition" --json -n 50
dsx search "tokenizer" --type thinking --json          # only model reasoning
dsx search "bun test" --tool Execute --errors --json   # failed Execute calls
dsx search "cache.*miss" --regex --json                # ripgrep over raw JSONL
dsx search "refactor" --history --json                 # user's typed prompts

# inspect a session (8-char id prefix is enough)
dsx show 22bc0eed --json          # metadata, usage, tool histogram, final todos
dsx export 22bc0eed --no-tools    # readable markdown transcript to stdout
dsx export 22bc0eed -f html -o /tmp/session.html
dsx path 22bc0eed                 # JSONL= and SETTINGS= file paths
dsx tree 22bc0eed                 # fork + subagent lineage
dsx resume 22bc0eed               # prints `cd ... && droid --resume <id>`

# analytics
dsx stats --json                            # overview totals
dsx stats --by day --since 30d --json       # also: model|project|tool|hour
dsx insights --since 30d --json             # heuristic findings, severity in [0,1]
dsx insights --kind expensive --json        # one kind, uncapped (without --kind, each
                                            # kind is capped at 10 findings)
dsx insights --deep                         # LLM-written brief via a droid exec sub-agent
                                            # (configurable: -m/--reasoning, $DSX_INSIGHTS_MODEL)

# delegate a question to a sub-droid that mines the index itself
dsx ask "when did I last touch the auth flow, and how?"
```

Insight kinds for `--kind`: `error_dense`, `retry_loops`, `interrupted`,
`abandoned`, `compaction_churn`, `expensive`, `marathon`. `expensive` is
relative to this user's own sessions: flagged above max(p95, 3x median) of
credit-bearing sessions, detail cites the median ratio and percentile.

## Workflow guidance

1. Start broad: `dsx search` or `dsx list` with filters.
2. Drill in: `dsx show <id>` for the shape, `dsx export <id> --no-tools` for content.
3. Cite session ids (8-char prefixes) in answers about past work.
4. For "what did this cost / how much did I use": `dsx stats` with `--by` and `--since`.
5. For "what went wrong lately": `dsx insights`.
6. Subagent and droid-exec sessions are hidden from `dsx list` by default; add `--all` to include them.

## Interpreting usage numbers

- Fork sessions inherit the parent's cumulative token/credit usage, so a deep
  fork chain shows inflated per-session totals. Use `dsx tree <id>` to find the
  lineage root before attributing cost; the chain's true cost is roughly the
  deepest fork's total, not the sum across the chain.
- Subagent and droid-exec sessions (including dsx's own `--deep`/`ask` runs,
  tagged `exec` + `dsx-insights`) are excluded from stats and insights and
  hidden from `dsx list` unless you pass `--all`.

## Notes

- Search hits include `sessionId` + `seq` (message ordinal) so you can locate
  context within a transcript.
- Snippets in `--json` mark matches with `[` `]`.
- The transcript exporter reads source JSONL, so content is full-fidelity even
  though the index caps indexed block size.
