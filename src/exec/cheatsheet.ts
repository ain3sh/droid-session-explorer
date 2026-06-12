/**
 * The dsx command reference handed to sub-droids (mirrors skills/dsx/SKILL.md).
 * Embedded as a string so compiled SEA binaries carry it without filesystem
 * lookups.
 */
export const DSX_CHEATSHEET = `
You have the \`dsx\` CLI available. It indexes every local droid session
(transcripts, token usage, tool calls, lineage). Mine it for ground truth.

Core commands (all support --json for stable machine-readable output; prefer it,
and add --no-refresh when running many commands in a row):
  dsx list [--project X] [--since 7d] [--query "fuzzy title"] [--sort credits|tokens|messages] [-n 50]
  dsx search "<fts query>" [--role user|assistant] [--type text,thinking,tool_use,tool_result] [--tool Execute] [--project X] [--since 30d] [-n 50]
      FTS5 syntax supported: "exact phrase", AND/OR/NOT, NEAR(a b, 5)
  dsx search "<regex>" --regex          # ripgrep over raw transcripts
  dsx search "<text>" --history         # the user's typed prompt history
  dsx show <id-or-prefix>               # full session summary, tool stats, todos
  dsx export <id> --no-tools            # readable markdown transcript to stdout
  dsx tree <id>                         # fork/subagent lineage
  dsx stats [--by day|model|project|tool|hour] [--since 30d]
  dsx insights [--since 30d] [--kind <kind>]
      kinds: error_dense, retry_loops, interrupted, abandoned, compaction_churn,
      expensive, marathon; severity is in [0,1]; without --kind each kind caps
      at 10 findings

Guidelines:
- Start broad (dsx search / dsx list), then drill into specific sessions with dsx show / dsx export.
- ALWAYS cite session ids (8-char prefixes are fine) for every claim.
- Prefer --json output when you need to reason over many rows.
- Fork sessions inherit the parent's cumulative token/credit usage: a deep fork
  chain shows inflated per-session totals. Check dsx tree before attributing cost.
- Subagent and droid-exec sessions are hidden from list/stats/insights unless --all.
- Keep the final answer concise and structured.
`

/** Whether the dsx binary is reachable for a sub-droid. */
export function dsxOnPath(): boolean {
  const probe = Bun.spawnSync(["which", "dsx"], { stdout: "ignore", stderr: "ignore" })
  return probe.exitCode === 0
}
