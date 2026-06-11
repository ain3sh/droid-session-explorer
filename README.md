# dsx — Droid Session Explorer

A fast CLI + TUI for searching, analyzing, and navigating your local
[Factory Droid](https://factory.ai) sessions. Everything stays on your machine.

- **Incremental index**: SQLite + FTS5 over `~/.factory/sessions` (transcripts,
  settings, prompt history). JSONL is append-only, so refreshes parse only new
  bytes: first index takes a few minutes over gigabytes, every refresh after is
  sub-second and runs automatically before each command.
- **Agent-first CLI**: every command has `--json` with stable shapes. A
  companion skill (`skills/dsx/SKILL.md`) teaches droids to mine their own past.
- **TUI**: OpenTUI (Solid) dashboard, fuzzy session browser, live full-text
  search, transcript reader, lineage trees, analytics.
- **Session graph**: forks (`session_start.parent`) and subagent calls
  (settings tags) form a navigable tree nobody else surfaces.

## Install

Single self-contained binary (no bun required), linux/macOS, x64/arm64:

```bash
curl -fsSL https://raw.githubusercontent.com/ain3sh/droid-session-explorer/main/install.sh | bash
```

Pin a version with `DSX_VERSION=v0.1.0`, change destination with
`DSX_INSTALL_DIR` (default `~/.local/bin`).

From source instead:

```bash
bun install
bun run build
bun link        # puts `dsx` on PATH
```

Optional: install the companion skill for droids:

```bash
ln -s "$(pwd)/skills/dsx" ~/.factory/skills/dsx
```

## Use

```bash
dsx                         # TUI (1-5 switch views, / filter, enter open, q quit)

dsx list --project vfs --since 7d
dsx search "race condition" --type thinking
dsx search "cache.*miss" --regex
dsx show 22bc0eed
dsx export 22bc0eed -f html -o session.html
dsx tree 22bc0eed
dsx stats --by model --since 30d
dsx insights
dsx resume 22bc0eed
dsx ask "how did I fix the tokenizer flake last month?"

dsx index --rebuild         # full reindex
dsx migrate-path /old/root /new/root [--apply]
```

Add `--json` to any query command for machine-readable output, `--no-refresh`
to skip the index freshness check.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `DROID_SESSION_ROOT` | `~/.factory/sessions` | session storage root |
| `DSX_DB_PATH` | `~/.cache/dsx/index.db` | index location |

## Development

```bash
bun run dev        # run from source (TUI needs the solid preload, included)
bun test           # fixture-based indexer/query tests
bun run typecheck
```
