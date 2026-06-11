import type { Command } from "commander"
import pc from "picocolors"
import type { AppContext } from "../../context"
import { insightsReport, type SignalKind } from "../../query/insights"
import {
  byDay,
  byGroup,
  byHour,
  byTool,
  totals,
  type StatsFilters,
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
    .option("--by <dim>", "day|model|project|tool|hour (default: overview)")
    .option("-p, --project <name>", "filter by project")
    .option("--since <when>", "window start (7d, 30d, 2026-01-01)")
    .option("--until <when>", "window end")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await ensureFresh(ctx, !program.opts().refresh)
      const filters: StatsFilters = {
        project: opts.project,
        since: opts.since ? parseWhen(opts.since) : undefined,
        until: opts.until ? parseWhen(opts.until) : undefined,
      }

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
          fail("--by must be one of day|model|project|tool|hour")
      }
    })

  program
    .command("insights")
    .description("heuristic signals: error-dense sessions, retry loops, interruptions, outliers")
    .option("-p, --project <name>", "filter by project")
    .option("--since <when>", "window start")
    .option("--kind <kind>", "only one signal kind")
    .option("-n, --limit <n>", "max findings", Number, 20)
    .option("--json", "JSON output")
    .action(async (opts) => {
      await ensureFresh(ctx, !program.opts().refresh)
      const report = insightsReport(ctx.db, {
        project: opts.project,
        since: opts.since ? parseWhen(opts.since) : undefined,
        limit: 500,
      })
      let insights = report.insights
      if (opts.kind) insights = insights.filter((i) => i.kind === opts.kind)
      insights = insights.slice(0, opts.limit)

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
