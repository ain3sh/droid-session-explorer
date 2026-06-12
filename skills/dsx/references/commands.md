# dsx command reference

All query commands support `--json` (stable shapes, treated as a public
contract) and auto-refresh the index first; add `--no-refresh` when running
many commands in a row. Session arguments accept 8-char id prefixes. Time
refs: `7d`, `24h`, `30m`, `2026-05-01`.

## find sessions

```bash
dsx list [-q "fuzzy title"] [-p <project>] [--since <when>] [--until <when>]
         [--model <substring>] [--min-credits <n>] [--all]
         [--sort updated|created|tokens|credits|messages|active] [-n 25] [--json]
```

- `-p/--project` matches the session cwd as a substring.
- Subagent and droid-exec sessions are hidden unless `--all`.

## full-text search

```bash
dsx search "<query>" [-p <project>] [--session <id>] [-r user|assistant]
          [--type text,thinking,tool_use,tool_result] [--tool <name>] [--errors]
          [--since <when>] [--until <when>] [-n 25] [--json]
```

- FTS5 syntax: `"exact phrase"`, `AND`, `OR`, `NOT`, `NEAR(a b, 5)`. Invalid
  syntax is auto-quoted, so raw error strings are safe to paste.
- Hits include `sessionId` + `seq` (message ordinal) to locate context within
  a transcript; JSON snippets mark matches with `[` `]`.
- `--errors` restricts to failed tool results; combine with `--tool Execute`.

Two alternate engines share the command:

```bash
dsx search "<regex>" --regex [-i]     # ripgrep over the raw JSONL transcripts
dsx search "<text>" --history         # the user's typed prompt history
```

## inspect a session

```bash
dsx show <id> [--json]                # metadata, usage, tool histogram, final todos
dsx export <id> [--no-tools] [--no-thinking] [-f md|html] [-o <file>]
dsx path <id> [--transcript] [--json] # JSONL= and SETTINGS= file paths
dsx tree <id> [--json]                # fork + subagent lineage
dsx resume <id> [--run]               # print (or exec) `cd ... && droid --resume <id>`
```

The exporter reads source JSONL, so content is full-fidelity even though the
index caps indexed block size.

## analytics

```bash
dsx stats [--by day|model|project|tool|hour] [-p <project>]
          [--since <when>] [--until <when>] [--json]
dsx insights [-p <project>] [--since <when>] [--kind <kind>] [-n 20] [--json]
dsx insights --deep [-m <model>] [--reasoning low|medium|high] [--json]
dsx ask "<question>" [-m <model>] [--cwd <path>]
```

- `insights` semantics (kinds, severity, outlier math) are documented in
  `interpreting.md`.
- `--deep` spawns a droid exec sub-agent that mines the index and writes a
  cited brief; the result streams to stdout and is cached for the TUI.
  Defaults come from `$DSX_INSIGHTS_MODEL` (kimi-k2.6) and
  `$DSX_INSIGHTS_REASONING` (low).
- `ask` delegates a one-off question to a sub-droid with this reference in its
  prompt.

## maintenance

```bash
dsx index [--rebuild] [--json]                  # force refresh / full re-ingest
dsx migrate-path <oldPrefix> <newPrefix> [--apply]  # after moving a project dir
```
