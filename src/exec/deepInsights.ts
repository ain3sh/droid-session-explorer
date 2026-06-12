import type { Database } from "bun:sqlite"
import type { AppContext } from "../context"
import { insightsReport } from "../query/insights"
import { DSX_CHEATSHEET, dsxOnPath } from "./cheatsheet"
import { runDroidTurn } from "./droid"

export interface DeepInsights {
  generatedAt: number
  model: string
  reasoningEffort: string
  narrative: string
  execSessionId: string | null
  filters: { project?: string; since?: number }
}

export interface DeepInsightsOptions {
  model?: string
  reasoningEffort?: string
  project?: string
  since?: number
  signal?: AbortSignal
  onDelta?: (text: string) => void
  onStatus?: (status: string) => void
}

const META_KEY = "deep_insights"

export function cachedDeepInsights(db: Database): DeepInsights | null {
  const row = db
    .query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?")
    .get(META_KEY)
  if (!row) return null
  try {
    return JSON.parse(row.value) as DeepInsights
  } catch {
    return null
  }
}

function saveDeepInsights(db: Database, value: DeepInsights): void {
  db.query("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    META_KEY,
    JSON.stringify(value),
  )
}

function buildPrompt(ctx: AppContext, opts: DeepInsightsOptions): string {
  const report = insightsReport(ctx.db, {
    project: opts.project,
    since: opts.since,
    limit: 40,
  })
  const findings = report.insights.map((i) => ({
    kind: i.kind,
    detail: i.detail,
    id: i.session.id.slice(0, 8),
    title: i.session.title,
    project: i.session.project,
  }))
  const window = opts.since
    ? `sessions updated since ${new Date(opts.since).toISOString().slice(0, 10)}`
    : "all indexed sessions"
  const scope = opts.project ? ` in project "${opts.project}"` : ""
  const drill = dsxOnPath()
    ? `Investigate before writing: use the dsx commands above (always --json, add --no-refresh)
to verify or refute each flagged signal. Prefer \`dsx show <id>\` and
\`dsx export <id> --no-tools\` for ground truth, and \`dsx stats --by model --since 30d\`
for cost context.`
    : `NOTE: the dsx binary is not on PATH in this environment, so you cannot drill into
sessions. Write the brief from the heuristic report alone and say so up front.`

  return `${DSX_CHEATSHEET}
You are writing the dsx deep-insights brief: an opinionated analysis of this
user's droid usage (${window}${scope}).

A heuristic scan of the session index produced this report (JSON):
${JSON.stringify({ overall: report.overall, findings })}

${drill}

Then write the brief in markdown, under 60 lines total, with exactly these sections:
## headline
One short paragraph: the state of this user's droid workflow.
## failure patterns
Recurring causes behind error/loop/interruption/abandon signals. Group by cause, not by session.
## cost & efficiency
Where credits actually went; separate true outliers from legitimately heavy work (fork chains
inherit cumulative usage, so call out inflated fork totals rather than treating them as waste).
## recommendations
3-5 specific, actionable changes ranked by impact.

Cite 8-char session ids for every claim. No filler, no hedging, no preamble before the
first heading, and stop after the last recommendation: no closing remarks or offers of help.`
}

export async function generateDeepInsights(
  ctx: AppContext,
  opts: DeepInsightsOptions = {},
): Promise<DeepInsights> {
  const model = opts.model ?? ctx.config.insightsModel
  const reasoningEffort = opts.reasoningEffort ?? ctx.config.insightsReasoning
  opts.onStatus?.(`starting droid exec (${model}, ${reasoningEffort} reasoning)`)
  const { text, execSessionId } = await runDroidTurn({
    prompt: buildPrompt(ctx, opts),
    cwd: process.cwd(),
    model,
    reasoningEffort,
    // stream-jsonrpc sessions carry only the tags the client passes (the CLI's
    // one-shot mode adds `exec` itself), so set it explicitly to keep these
    // runs out of dsx's own reports.
    tags: ["exec", "dsx-insights"],
    signal: opts.signal,
    onDelta: opts.onDelta,
    onStatus: opts.onStatus,
  })
  const narrative = text.trim()
  if (!narrative) throw new Error("droid exec produced no narrative")
  const result: DeepInsights = {
    generatedAt: Date.now(),
    model,
    reasoningEffort,
    narrative,
    execSessionId,
    filters: { project: opts.project, since: opts.since },
  }
  saveDeepInsights(ctx.db, result)
  return result
}
