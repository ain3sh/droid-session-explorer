// The skill reference files double as the sub-droid cheatsheet: imported as
// text so they are embedded into bundles and SEA binaries at build time, with
// .agents/skills/dsx/references/ as the single source of truth.
import commandsRef from "../../.agents/skills/dsx/references/commands.md" with { type: "text" }
import insightsRef from "../../.agents/skills/dsx/references/insights.md" with { type: "text" }
import statsAnalyticsRef from "../../.agents/skills/dsx/references/stats-analytics.md" with { type: "text" }
import usageSemanticsRef from "../../.agents/skills/dsx/references/usage-semantics.md" with { type: "text" }

export const DSX_CHEATSHEET = `
You have the \`dsx\` CLI available. It indexes every local droid session
(transcripts, token usage, tool calls, lineage). Mine it for ground truth.

${commandsRef}
${usageSemanticsRef}
${statsAnalyticsRef}
${insightsRef}
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
