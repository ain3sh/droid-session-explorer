// The skill reference files double as the sub-droid cheatsheet; they are
// embedded at build time via src/sync/embedded.ts.
import { SKILL_FILES } from "../sync/embedded"

export const DSX_CHEATSHEET = `
You have the \`dsx\` CLI available. It indexes every local droid session
(transcripts, token usage, tool calls, lineage). Mine it for ground truth.

${SKILL_FILES["references/commands.md"]}
${SKILL_FILES["references/usage-semantics.md"]}
${SKILL_FILES["references/stats-analytics.md"]}
${SKILL_FILES["references/insights.md"]}
Guidelines:
- Start broad (dsx search / dsx list), then drill into specific sessions with dsx show / dsx export.
- ALWAYS cite session ids (8-char prefixes are fine) for every claim.
- Prefer --json output when you need to reason over many rows.
- Keep the final answer concise and structured.
`

/** Whether the dsx binary is reachable for a sub-droid. */
export function dsxOnPath(): boolean {
  const probe = Bun.spawnSync(["which", "dsx"], { stdout: "ignore", stderr: "ignore" })
  return probe.exitCode === 0
}
