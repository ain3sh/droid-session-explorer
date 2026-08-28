// Companion assets are imported as text so bundles and SEA binaries carry
// every file. .agents/skills/dsx/ is the single source of truth for the
// skill (same content backs both `dsx sync` and the sub-droid cheatsheet);
// agents-block.md is the source for the managed AGENTS.md block.
import agentsBlock from "./agents-block.md" with { type: "text" }
import skillMd from "../../.agents/skills/dsx/SKILL.md" with { type: "text" }
import commandsRef from "../../.agents/skills/dsx/references/commands.md" with { type: "text" }
import insightsRef from "../../.agents/skills/dsx/references/insights.md" with { type: "text" }
import statsAnalyticsRef from "../../.agents/skills/dsx/references/stats-analytics.md" with { type: "text" }
import usageSemanticsRef from "../../.agents/skills/dsx/references/usage-semantics.md" with { type: "text" }

/** Relative path -> content for every file in the companion skill. */
export const SKILL_FILES: Record<string, string> = {
  "SKILL.md": skillMd,
  "references/commands.md": commandsRef,
  "references/usage-semantics.md": usageSemanticsRef,
  "references/stats-analytics.md": statsAnalyticsRef,
  "references/insights.md": insightsRef,
}

/** Guidance installed into AGENTS.md files as a dsx-managed block. */
export const AGENTS_BLOCK_CONTENT: string = agentsBlock
