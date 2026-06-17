import { createMemo, createSignal, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
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
  type DailyGroupUsage,
  type StatsFilters,
  type UsageMetric,
} from "../../query/stats"
import { humanDuration, humanTokens, parseWhen, sparkline } from "../../cli/format"
import { useApp } from "../state"
import { T } from "../theme"

type Dim =
  | "model"
  | "project"
  | "day"
  | "day-model"
  | "day-project"
  | "tool"
  | "day-tool"
  | "project-model"
  | "segment"
  | "dist"
  | "hour"

const DIMS: Dim[] = [
  "model",
  "project",
  "day",
  "day-model",
  "day-project",
  "tool",
  "day-tool",
  "project-model",
  "segment",
  "dist",
  "hour",
]
const WINDOWS = [null, "7d", "30d", "90d"] as const
const METRICS: UsageMetric[] = [
  "credits",
  "totalTokens",
  "inputTokens",
  "outputTokens",
  "messages",
  "sessions",
  "toolCalls",
  "toolErrors",
  "errorRate",
  "tokensPerMessage",
]

export function StatsView() {
  const app = useApp()
  const [dim, setDim] = createSignal<Dim>("model")
  const [win, setWin] = createSignal<(typeof WINDOWS)[number]>(null)
  const [metric, setMetric] = createSignal<UsageMetric>("credits")
  const [project, setProject] = createSignal("")
  const [model, setModel] = createSignal("")
  const [all, setAll] = createSignal(false)
  const [editing, setEditing] = createSignal<null | "project" | "model">(null)

  const filters = createMemo<StatsFilters>(() => ({
    project: project() || undefined,
    model: model() || undefined,
    since: win() ? parseWhen(win()!) : undefined,
    includeSubagents: all(),
    includeExec: all(),
  }))

  useKeyboard((key) => {
    if (editing()) {
      if (key.name === "escape" || key.name === "return") {
        setTimeout(() => {
          setEditing(null)
          app.setInputActive(false)
        }, 0)
      }
      return
    }
    if (app.inputActive()) return
    const seq = key.sequence ?? key.name
    if (seq === "tab" || key.name === "tab") {
      setDim((d) => DIMS[(DIMS.indexOf(d) + 1) % DIMS.length]!)
    } else if (seq === "w") {
      setWin((w) => WINDOWS[(WINDOWS.indexOf(w) + 1) % WINDOWS.length]!)
    } else if (seq === "v") {
      setMetric((m) => METRICS[(METRICS.indexOf(m) + 1) % METRICS.length]!)
    } else if (seq === "a") {
      setAll((v) => !v)
    } else if (seq === "p" || seq === "m") {
      const field = seq === "p" ? "project" : "model"
      app.setInputActive(true)
      setTimeout(() => setEditing(field), 0)
    }
  })

  const rows = createMemo<string[]>(() => {
    const db = app.ctx.db
    const f = filters()
    switch (dim()) {
      case "model":
      case "project":
        return byGroup(db, dim() as "model" | "project", f)
          .slice(0, 30)
          .map(
            (g) => {
              const rates = deriveUsageRates(g)
              return `${(dim() === "project" ? shortProject(g.key) : g.key)
                .padEnd(36)
                .slice(0, 36)} ${String(g.sessions).padStart(5)} ses ${humanTokens(g.inputTokens).padStart(8)} in ${humanTokens(g.outputTokens).padStart(8)} out ${humanDuration(g.activeTimeMs).padStart(8)} ${formatRate(rates.creditsPerOutputToken).padStart(9)} cr/out ${g.credits.toLocaleString().padStart(15)} cr`
            },
          )
      case "project-model":
        return byGroupPair(db, "project", "model", f)
          .slice(0, 40)
          .map((r) => {
            const rates = deriveUsageRates(r)
            return `${shortProject(r.leftKey).padEnd(28).slice(0, 28)} ${r.rightKey.padEnd(24).slice(0, 24)} ${String(r.sessions).padStart(5)} ses ${humanTokens(r.inputTokens).padStart(8)} in ${humanTokens(r.outputTokens).padStart(8)} out ${humanTokens(Math.round(rates.tokensPerMessage)).padStart(8)} tok/msg ${r.credits.toLocaleString().padStart(13)} cr`
          })
      case "tool":
        return byTool(db, f)
          .slice(0, 30)
          .map(
            (t) =>
              `${t.tool.padEnd(36).slice(0, 36)} ${t.calls.toLocaleString().padStart(9)} calls ${String(t.errors).padStart(7)} err (${
                t.calls ? ((t.errors / t.calls) * 100).toFixed(1) : "0"
              }%)  ${String(t.sessions).padStart(5)} ses`,
          )
      case "day":
        {
          const days = byDay(db, f).slice(-60)
          return [
            `${metric()} ${sparkline(days.map((d) => metricValue(d, metric())))}`,
            ...days.slice(-35).map(
              (d) =>
                `${d.day}  ${String(d.sessions).padStart(4)} ses ${String(d.messages).padStart(7)} msgs ${humanTokens(d.inputTokens).padStart(8)} in ${humanTokens(d.outputTokens).padStart(8)} out ${d.credits.toLocaleString().padStart(15)} cr`,
            ),
          ]
        }
      case "day-model":
        return renderDailyGroups(byDayGroup(db, "model", f), metric(), false)
      case "day-project":
        return renderDailyGroups(byDayGroup(db, "project", f), metric(), true)
      case "day-tool":
        return byToolMatrix(db, "day", f)
          .slice(0, 50)
          .map(
            (r) =>
              `${r.key} ${r.tool.padEnd(28).slice(0, 28)} ${String(r.calls).padStart(8)} calls ${String(r.errors).padStart(6)} err ${`${(r.errorRate * 100).toFixed(1)}%`.padStart(7)} ${String(r.sessions).padStart(5)} ses`,
          )
      case "segment":
        return bySegment(db, f).map((s) => {
          const err = s.toolCalls ? (s.toolErrors / s.toolCalls) * 100 : 0
          return `${s.segment.padEnd(10)} ${String(s.sessions).padStart(5)} ses ${humanTokens(s.inputTokens).padStart(8)} in ${humanTokens(s.outputTokens).padStart(8)} out ${humanDuration(s.activeTimeMs).padStart(8)} ${err.toFixed(1).padStart(6)}% err ${s.credits.toLocaleString().padStart(15)} cr`
        })
      case "dist": {
        const dist = distribution(db, distributionMetric(metric()), f)
        const max = Math.max(...dist.buckets.map((b) => b.count), 1)
        return [
          `${dist.metric}: count=${dist.count} min=${formatDistribution(dist.min, dist.metric)} p50=${formatDistribution(dist.p50, dist.metric)} p90=${formatDistribution(dist.p90, dist.metric)} p95=${formatDistribution(dist.p95, dist.metric)} max=${formatDistribution(dist.max, dist.metric)}`,
          ...dist.buckets.map(
            (b) =>
              `${formatDistribution(b.from, dist.metric).padStart(8)}-${formatDistribution(b.to, dist.metric).padEnd(8)} ${"\u2588".repeat(Math.round((b.count / max) * 44)).padEnd(44)} ${b.count}`,
          ),
        ]
      }
      case "hour": {
        const hours = byHour(db, f)
        const map = new Map(hours.map((h) => [h.hour, h.messages]))
        const values = Array.from({ length: 24 }, (_, h) => map.get(h) ?? 0)
        const max = Math.max(...values, 1)
        return values.map(
          (v, h) =>
            `${String(h).padStart(2, "0")}:00 ${"\u2588".repeat(Math.round((v / max) * 50)).padEnd(50)} ${v.toLocaleString()}`,
        )
      }
    }
  })

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box height={1} flexDirection="row" gap={1}>
        <For each={DIMS}>
          {(d) => (
            <text>
              {dim() === d ? (
                <span style={{ fg: T.bg, bg: T.accent }}>{` ${d} `}</span>
              ) : (
                <span style={{ fg: T.dim }}>{` ${d} `}</span>
              )}
            </text>
          )}
        </For>
        <text>
          <span style={{ fg: T.dim }}>(tab)</span>
        </text>
      </box>
      <box height={1} flexDirection="row" gap={2}>
        <text>
          <span style={{ fg: T.dim }}>w:window </span>
          <span style={{ fg: T.cyan }}>{win() ?? "all"}</span>
        </text>
        <text>
          <span style={{ fg: T.dim }}>v:metric </span>
          <span style={{ fg: T.yellow }}>{metric()}</span>
        </text>
        <text>
          <span style={{ fg: T.dim }}>a:scope </span>
          <span style={{ fg: T.magenta }}>{all() ? "all" : "main"}</span>
        </text>
        <text>
          <span style={{ fg: editing() === "project" ? T.yellow : T.dim }}>p:project </span>
        </text>
        <input value={project()} onInput={setProject} placeholder="all" focused={editing() === "project"} width={18} />
        <text>
          <span style={{ fg: editing() === "model" ? T.yellow : T.dim }}>m:model </span>
        </text>
        <input value={model()} onInput={setModel} placeholder="all" focused={editing() === "model"} width={20} />
      </box>
      <scrollbox focused flexGrow={1}>
        <For each={rows()}>
          {(row) => (
            <text selectable fg={T.fg}>
              {row}
            </text>
          )}
        </For>
      </scrollbox>
    </box>
  )
}

function shortProject(key: string): string {
  return key.split("/").slice(-2).join("/")
}

function formatRate(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function renderDailyGroups(
  rows: DailyGroupUsage[],
  metric: UsageMetric,
  shortenProject: boolean,
): string[] {
  if (rows.length === 0) return ["no matching usage"]
  const days = [...new Set(rows.map((r) => r.day))].sort()
  const byKey = new Map<string, DailyGroupUsage[]>()
  for (const row of rows) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row])
  return [...byKey.entries()]
    .map(([key, values]) => ({
      key,
      values,
      total: values.reduce((sum, row) => sum + metricValue(row, metric), 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12)
    .map((item) => {
      const byDay = new Map(item.values.map((v) => [v.day, metricValue(v, metric)]))
      const name = shortenProject ? shortProject(item.key) : item.key
      return `${name.padEnd(32).slice(0, 32)} ${formatUsageMetric(item.total, metric).padStart(10)} ${sparkline(days.map((d) => byDay.get(d) ?? 0))}`
    })
}

function formatUsageMetric(value: number, metric: UsageMetric): string {
  switch (metric) {
    case "errorRate":
      return `${(value * 100).toFixed(1)}%`
    case "sessions":
    case "messages":
    case "toolCalls":
    case "toolErrors":
      return Math.round(value).toLocaleString()
    default:
      return humanTokens(Math.round(value))
  }
}

function distributionMetric(metric: UsageMetric): "credits" | "tokens" | "active" | "toolErrors" {
  if (metric === "toolErrors") return "toolErrors"
  if (metric === "inputTokens" || metric === "outputTokens" || metric === "totalTokens") return "tokens"
  return "credits"
}

function formatDistribution(
  value: number,
  metric: "credits" | "tokens" | "active" | "toolErrors",
): string {
  return metric === "active" ? humanDuration(value) : humanTokens(Math.round(value))
}
