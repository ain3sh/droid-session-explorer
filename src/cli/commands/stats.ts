import type { Command } from "commander"
import pc from "picocolors"
import type { AppContext } from "../../context"
import { insightsReport, type SignalKind } from "../../query/insights"
import {
  byDay,
  byDayGroup,
  byGroup,
  byGroupPair,
  byHour,
  bySegment,
  byTool,
  byToolMatrix,
  deriveUsageRates,
  distribution,
  metricValue,
  totals,
  type DailyGroupUsage,
  type GroupPairUsage,
  type StatsFilters,
  type ToolMatrixUsage,
  type UsageLike,
  type UsageMetric,
} from "../../query/stats"
import {
  fail,
  heatChar,
  humanDate,
  humanDuration,
  humanTokens,
  output,
  parseWhen,
  renderTable,
  sparkline,
} from "../format"
import { ensureFresh } from "../refresh"

export function registerStatsCommands(program: Command, ctx: AppContext): void {
  program
    .command("stats")
    .description("usage analytics: tokens, credits, models, projects, tools, activity")
    .option(
      "--by <dim>",
      "day|model|project|tool|hour|day-model|day-project|project-model|day-tool|project-tool|model-tool|segment|dist",
    )
    .option("-p, --project <name>", "filter by project")
    .option("--model <model>", "filter by model substring")
    .option("--since <when>", "window start (7d, 30d, 2026-01-01)")
    .option("--until <when>", "window end")
    .option("--metric <metric>", "credits|inputTokens|outputTokens|totalTokens|messages|sessions|toolCalls|toolErrors")
    .option("--all", "include subagent and droid-exec sessions")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await ensureFresh(ctx, !program.opts().refresh)
      const filters: StatsFilters = {
        project: opts.project,
        model: opts.model,
        since: opts.since ? parseWhen(opts.since) : undefined,
        until: opts.until ? parseWhen(opts.until) : undefined,
        includeSubagents: opts.all,
        includeExec: opts.all,
      }
      const usageMetric = () => parseUsageMetric(opts.metric)

      switch (opts.by) {
        case undefined: {
          const t = totals(ctx.db, filters)
          const days = byDay(ctx.db, filters).slice(-90)
          output(opts.json, { totals: t, days }, () => {
            const lines: string[] = []
            const label = (k: string, v: string) => `${pc.dim(k.padEnd(16))}${v}`
            lines.push(pc.bold("droid usage overview"))
            lines.push(label("sessions", t.sessions.toLocaleString()))
            lines.push(
              label(
                "tokens",
                `in=${humanTokens(t.inputTokens)} out=${humanTokens(t.outputTokens)} cache=${humanTokens(t.cacheReadTokens)} think=${humanTokens(t.thinkingTokens)}`,
              ),
            )
            lines.push(label("credits", pc.bold(t.credits.toLocaleString())))
            lines.push(label("active time", humanDuration(t.activeTimeMs)))
            lines.push(label("messages", t.messages.toLocaleString()))
            lines.push(
              label(
                "tool calls",
                `${t.toolCalls.toLocaleString()} (${t.toolErrors.toLocaleString()} errors, ${
                  t.toolCalls ? ((t.toolErrors / t.toolCalls) * 100).toFixed(1) : 0
                }%)`,
              ),
            )
            if (days.length > 1) {
              lines.push("")
              lines.push(pc.bold(`daily credits (last ${days.length} active days)`))
              lines.push(sparkline(days.map((d) => d.credits)))
              lines.push(heatmapCalendar(days.map((d) => [d.day, d.credits])))
            }
            return lines.join("\n")
          })
          return
        }
        case "day": {
          const days = byDay(ctx.db, filters)
          output(opts.json, days, () =>
            renderTable(days.slice(-45), [
              { header: "DAY", value: (d) => d.day },
              { header: "SESSIONS", value: (d) => String(d.sessions), align: "right" },
              { header: "MSGS", value: (d) => String(d.messages), align: "right" },
              { header: "IN", value: (d) => humanTokens(d.inputTokens), align: "right" },
              { header: "OUT", value: (d) => humanTokens(d.outputTokens), align: "right" },
              {
                header: "CREDITS",
                value: (d) => d.credits.toLocaleString(),
                align: "right",
              },
            ]),
          )
          return
        }
        case "day-model":
        case "day-project": {
          const group = opts.by === "day-model" ? "model" : "project"
          const rows = byDayGroup(ctx.db, group, filters)
          output(opts.json, rows, () =>
            renderDailyGroup(rows, {
              label: group,
              metric: usageMetric(),
              shortenProject: group === "project",
            }),
          )
          return
        }
        case "model":
        case "project": {
          const groups = byGroup(ctx.db, opts.by, filters)
          output(opts.json, groups, () =>
            renderTable(groups.slice(0, 30), [
              {
                header: opts.by.toUpperCase(),
                value: (g) =>
                  opts.by === "project" ? g.key.split("/").slice(-2).join("/") : g.key,
              },
              { header: "SESSIONS", value: (g) => String(g.sessions), align: "right" },
              { header: "IN", value: (g) => humanTokens(g.inputTokens), align: "right" },
              { header: "OUT", value: (g) => humanTokens(g.outputTokens), align: "right" },
              { header: "ACTIVE", value: (g) => humanDuration(g.activeTimeMs), align: "right" },
              {
                header: "CREDITS",
                value: (g) => g.credits.toLocaleString(),
                align: "right",
              },
            ]),
          )
          return
        }
        case "project-model": {
          const pairs = byGroupPair(ctx.db, "project", "model", filters)
          output(opts.json, pairs, () => renderGroupPairs(pairs))
          return
        }
        case "tool": {
          const tools = byTool(ctx.db, filters)
          output(opts.json, tools, () =>
            renderTable(tools.slice(0, 30), [
              { header: "TOOL", value: (t) => t.tool },
              { header: "CALLS", value: (t) => t.calls.toLocaleString(), align: "right" },
              {
                header: "ERRORS",
                value: (t) => String(t.errors),
                align: "right",
                color: (v, t) => (t.errors > 0 ? pc.red(v) : pc.dim(v)),
              },
              {
                header: "ERR%",
                value: (t) => (t.calls ? ((t.errors / t.calls) * 100).toFixed(1) : "0"),
                align: "right",
              },
              { header: "SESSIONS", value: (t) => String(t.sessions), align: "right" },
            ]),
          )
          return
        }
        case "day-tool":
        case "project-tool":
        case "model-tool": {
          const group =
            opts.by === "day-tool" ? "day" : opts.by === "project-tool" ? "project" : "model"
          const rows = byToolMatrix(ctx.db, group, filters)
          output(opts.json, rows, () => renderToolMatrix(rows, group))
          return
        }
        case "segment": {
          const segments = bySegment(ctx.db, filters)
          output(opts.json, segments, () =>
            renderTable(segments, [
              { header: "SEGMENT", value: (s) => s.segment },
              { header: "SESSIONS", value: (s) => String(s.sessions), align: "right" },
              { header: "IN", value: (s) => humanTokens(s.inputTokens), align: "right" },
              { header: "OUT", value: (s) => humanTokens(s.outputTokens), align: "right" },
              { header: "ACTIVE", value: (s) => humanDuration(s.activeTimeMs), align: "right" },
              {
                header: "ERR%",
                value: (s) =>
                  s.toolCalls ? ((s.toolErrors / s.toolCalls) * 100).toFixed(1) : "0",
                align: "right",
              },
              { header: "CREDITS", value: (s) => s.credits.toLocaleString(), align: "right" },
            ]),
          )
          return
        }
        case "dist": {
          const dist = distribution(ctx.db, parseDistributionMetric(opts.metric), filters)
          output(opts.json, dist, () => renderDistribution(dist))
          return
        }
        case "hour": {
          const hours = byHour(ctx.db, filters)
          const byH = new Map(hours.map((h) => [h.hour, h.messages]))
          const values = Array.from({ length: 24 }, (_, h) => byH.get(h) ?? 0)
          output(opts.json, hours, () => {
            const max = Math.max(...values, 1)
            const lines = [pc.bold("activity by hour (messages)")]
            values.forEach((v, h) => {
              const bar = "\u2588".repeat(Math.round((v / max) * 40))
              lines.push(
                `${String(h).padStart(2, "0")}:00 ${pc.green(bar)} ${pc.dim(v.toLocaleString())}`,
              )
            })
            return lines.join("\n")
          })
          return
        }
        default:
          fail(
            "--by must be one of day|model|project|tool|hour|day-model|day-project|project-model|day-tool|project-tool|model-tool|segment|dist",
          )
      }
    })

  program
    .command("insights")
    .description("heuristic signals: error-dense sessions, retry loops, interruptions, outliers")
    .option("-p, --project <name>", "filter by project")
    .option("--since <when>", "window start")
    .option("--kind <kind>", "only one signal kind")
    .option("-n, --limit <n>", "max findings", Number, 20)
    .option("--deep", "LLM-written brief via droid exec (streams to stdout, cached for the TUI)")
    .option("-m, --model <id>", "model for --deep (default: $DSX_INSIGHTS_MODEL or kimi-k2.6)")
    .option("--reasoning <effort>", "reasoning effort for --deep (default: low)")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await ensureFresh(ctx, !program.opts().refresh)
      const since = opts.since ? parseWhen(opts.since) : undefined

      if (opts.deep) {
        const { generateDeepInsights } = await import("../../exec/deepInsights")
        try {
          const result = await generateDeepInsights(ctx, {
            model: opts.model,
            reasoningEffort: opts.reasoning,
            project: opts.project,
            since,
            onDelta: opts.json ? undefined : (t) => process.stdout.write(t),
            onStatus: (s) => console.error(pc.dim(`dsx: ${s}`)),
          })
          if (opts.json) console.log(JSON.stringify(result, null, 2))
          else process.stdout.write("\n")
        } catch (e) {
          fail(e instanceof Error ? e.message : String(e))
        }
        return
      }

      const report = insightsReport(ctx.db, {
        project: opts.project,
        since,
        kind: opts.kind as SignalKind | undefined,
        limit: 500,
      })
      const insights = report.insights.slice(0, opts.limit)

      output(opts.json, { ...report, insights }, () => {
        const lines: string[] = []
        const o = report.overall
        lines.push(pc.bold("session health"))
        lines.push(
          `${pc.dim("sessions".padEnd(20))}${o.sessions}   ${pc.dim("tool error rate")} ${(o.toolErrorRate * 100).toFixed(1)}%   ${pc.dim("interruption rate")} ${(o.interruptionRate * 100).toFixed(1)}%   ${pc.dim("abandon rate")} ${(o.abandonRate * 100).toFixed(1)}%`,
        )
        lines.push("")
        if (insights.length === 0) {
          lines.push(pc.green("no notable findings"))
          return lines.join("\n")
        }
        lines.push(pc.bold("findings"))
        for (const ins of insights) {
          lines.push(
            `${kindBadge(ins.kind)} ${pc.cyan(ins.session.id.slice(0, 8))} ${pc.dim(
              humanDate(ins.session.updatedAt),
            )} ${(ins.session.title ?? "(untitled)").slice(0, 50)}`,
          )
          lines.push(`   ${ins.detail}`)
        }
        return lines.join("\n")
      })
    })
}

const USAGE_METRICS: UsageMetric[] = [
  "credits",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "messages",
  "sessions",
  "toolCalls",
  "toolErrors",
  "errorRate",
  "creditsPerOutputToken",
  "creditsPerActiveHour",
  "tokensPerMessage",
]

function parseUsageMetric(input: string | undefined): UsageMetric {
  if (!input) return "credits"
  if (USAGE_METRICS.includes(input as UsageMetric)) return input as UsageMetric
  fail(`--metric must be one of ${USAGE_METRICS.join("|")}`)
}

function parseDistributionMetric(input: string | undefined) {
  if (!input || input === "credits") return "credits"
  if (input === "tokens" || input === "totalTokens") return "tokens"
  if (input === "active") return "active"
  if (input === "toolErrors") return "toolErrors"
  fail("--metric for --by dist must be one of credits|tokens|totalTokens|active|toolErrors")
}

function formatMetric(value: number, metric: UsageMetric): string {
  switch (metric) {
    case "credits":
    case "inputTokens":
    case "outputTokens":
    case "totalTokens":
    case "tokensPerMessage":
      return humanTokens(Math.round(value))
    case "errorRate":
      return `${(value * 100).toFixed(1)}%`
    case "creditsPerOutputToken":
    case "creditsPerActiveHour":
      return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
    default:
      return Math.round(value).toLocaleString()
  }
}

function renderDailyGroup(
  rows: DailyGroupUsage[],
  opts: { label: string; metric: UsageMetric; shortenProject: boolean },
): string {
  if (rows.length === 0) return pc.dim("no matching usage")
  const days = [...new Set(rows.map((r) => r.day))].sort()
  const byKey = new Map<string, DailyGroupUsage[]>()
  for (const row of rows) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row])
  const series = [...byKey.entries()]
    .map(([key, values]) => ({
      key,
      values,
      total: values.reduce((sum, row) => sum + metricValue(row, opts.metric), 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12)

  const lines = [pc.bold(`daily ${opts.label} by ${opts.metric}`)]
  for (const item of series) {
    const byDay = new Map(item.values.map((v) => [v.day, metricValue(v, opts.metric)]))
    const name = opts.shortenProject ? item.key.split("/").slice(-2).join("/") : item.key
    lines.push(
      `${name.padEnd(32).slice(0, 32)} ${formatMetric(item.total, opts.metric).padStart(10)} ${pc.green(
        sparkline(days.map((d) => byDay.get(d) ?? 0)),
      )}`,
    )
  }
  return lines.join("\n")
}

function renderGroupPairs(rows: GroupPairUsage[]): string {
  return renderTable(rows.slice(0, 40), [
    { header: "PROJECT", value: (r) => r.leftKey.split("/").slice(-2).join("/") },
    { header: "MODEL", value: (r) => r.rightKey },
    { header: "SESSIONS", value: (r) => String(r.sessions), align: "right" },
    { header: "IN", value: (r) => humanTokens(r.inputTokens), align: "right" },
    { header: "OUT", value: (r) => humanTokens(r.outputTokens), align: "right" },
    {
      header: "TOK/MSG",
      value: (r) => humanTokens(Math.round(deriveUsageRates(r).tokensPerMessage)),
      align: "right",
    },
    { header: "CREDITS", value: (r) => r.credits.toLocaleString(), align: "right" },
  ])
}

function renderToolMatrix(rows: ToolMatrixUsage[], group: string): string {
  if (rows.length === 0) return pc.dim("no matching tool usage")
  return renderTable(rows.slice(0, 50), [
    {
      header: group.toUpperCase(),
      value: (r) => (group === "project" ? r.key.split("/").slice(-2).join("/") : r.key),
    },
    { header: "TOOL", value: (r) => r.tool },
    { header: "CALLS", value: (r) => r.calls.toLocaleString(), align: "right" },
    {
      header: "ERRORS",
      value: (r) => String(r.errors),
      align: "right",
      color: (v, r) => (r.errors > 0 ? pc.red(v) : pc.dim(v)),
    },
    { header: "ERR%", value: (r) => (r.errorRate * 100).toFixed(1), align: "right" },
    { header: "SESSIONS", value: (r) => String(r.sessions), align: "right" },
  ])
}

function renderDistribution(dist: ReturnType<typeof distribution>): string {
  if (dist.count === 0) return pc.dim("no matching sessions")
  const maxBucket = Math.max(...dist.buckets.map((b) => b.count), 1)
  const fmt = (n: number) =>
    dist.metric === "active" ? humanDuration(n) : humanTokens(Math.round(n))
  const lines = [
    pc.bold(`${dist.metric} distribution`),
    `count=${dist.count.toLocaleString()} min=${fmt(dist.min)} p50=${fmt(dist.p50)} p90=${fmt(dist.p90)} p95=${fmt(dist.p95)} max=${fmt(dist.max)}`,
  ]
  for (const b of dist.buckets) {
    lines.push(
      `${fmt(b.from).padStart(8)}-${fmt(b.to).padEnd(8)} ${pc.green(
        "\u2588".repeat(Math.round((b.count / maxBucket) * 32)),
      )} ${b.count.toLocaleString()}`,
    )
  }
  return lines.join("\n")
}

function kindBadge(kind: SignalKind): string {
  switch (kind) {
    case "error_dense":
      return pc.red("[errors]   ")
    case "retry_loops":
      return pc.yellow("[loops]    ")
    case "interrupted":
      return pc.yellow("[cancels]  ")
    case "abandoned":
      return pc.red("[abandoned]")
    case "compaction_churn":
      return pc.magenta("[churn]    ")
    case "expensive":
      return pc.blue("[cost]     ")
    case "marathon":
      return pc.blue("[marathon] ")
  }
}

/** Render a GitHub-style weekly calendar from (day, value) pairs. */
function heatmapCalendar(entries: Array<[string, number]>): string {
  if (entries.length === 0) return ""
  const valueByDay = new Map(entries)
  const max = Math.max(...entries.map(([, v]) => v), 1)
  const end = new Date()
  const start = new Date(entries[0]![0])
  // Align start to Sunday
  start.setDate(start.getDate() - start.getDay())

  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

  const weeks: string[][] = []
  for (let cursor = new Date(start); cursor <= end; ) {
    const week: string[] = []
    for (let dow = 0; dow < 7; dow++) {
      week.push(cursor <= end ? heatChar(valueByDay.get(dayKey(cursor)) ?? 0, max) : " ")
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  const rows: string[] = []
  const labels = ["   ", "Mon", "   ", "Wed", "   ", "Fri", "   "]
  for (let dow = 0; dow < 7; dow++) {
    rows.push(`${pc.dim(labels[dow]!)} ${weeks.map((w) => w[dow]).join("")}`)
  }
  return rows.join("\n")
}
