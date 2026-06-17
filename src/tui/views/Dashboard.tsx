import { createMemo, For } from "solid-js"
import { listSessions } from "../../query/sessions"
import { byDay, byGroup, totals } from "../../query/stats"
import { humanDate, humanDuration, humanTokens, sparkline } from "../../cli/format"
import { useApp } from "../state"
import { T } from "../theme"
import { projectName } from "../../query/types"

export function Dashboard() {
  const app = useApp()
  const t = createMemo(() => totals(app.ctx.db))
  const days = createMemo(() => byDay(app.ctx.db).slice(-60))
  const models = createMemo(() => byGroup(app.ctx.db, "model").slice(0, 5))
  const projects = createMemo(() => byGroup(app.ctx.db, "project").slice(0, 5))
  const recent = createMemo(() => listSessions(app.ctx.db, { limit: 10 }))

  return (
    <box flexDirection="column" padding={1} gap={1}>
      <box flexDirection="row" gap={2}>
        <Kpi label="sessions" value={t().sessions.toLocaleString()} color={T.accent} />
        <Kpi label="credits" value={humanTokens(t().credits)} color={T.yellow} />
        <Kpi
          label="tokens in/out"
          value={`${humanTokens(t().inputTokens)}/${humanTokens(t().outputTokens)}`}
          color={T.cyan}
        />
        <Kpi label="active time" value={humanDuration(t().activeTimeMs)} color={T.green} />
        <Kpi
          label="tool errors"
          value={`${((t().toolErrors / Math.max(1, t().toolCalls)) * 100).toFixed(1)}%`}
          color={T.red}
        />
      </box>

      <box border borderStyle="single" borderColor={T.border} paddingX={1} title="daily credits (main)" titleAlignment="left">
        <text>
          <span style={{ fg: T.green }}>{sparkline(days().map((d) => d.credits))}</span>
        </text>
      </box>

      <box flexDirection="row" gap={1}>
        <box flexGrow={1} border borderStyle="single" borderColor={T.border} paddingX={1} flexDirection="column" title="top models" titleAlignment="left">
          <For each={models()}>
            {(m) => (
              <text>
                <span style={{ fg: T.magenta }}>{m.key.padEnd(22).slice(0, 22)}</span>
                <span style={{ fg: T.dim }}>{String(m.sessions).padStart(5)} ses </span>
                <span style={{ fg: T.yellow }}>{humanTokens(m.credits).padStart(8)}</span>
              </text>
            )}
          </For>
        </box>
        <box flexGrow={1} border borderStyle="single" borderColor={T.border} paddingX={1} flexDirection="column" title="top projects" titleAlignment="left">
          <For each={projects()}>
            {(p) => (
              <text>
                <span style={{ fg: T.cyan }}>{projectName(p.key, p.key).padEnd(22).slice(0, 22)}</span>
                <span style={{ fg: T.dim }}>{String(p.sessions).padStart(5)} ses </span>
                <span style={{ fg: T.yellow }}>{humanTokens(p.credits).padStart(8)}</span>
              </text>
            )}
          </For>
        </box>
      </box>

      <box border borderStyle="single" borderColor={T.border} paddingX={1} flexDirection="column" flexGrow={1} title="recent sessions (2 to browse)" titleAlignment="left">
        <For each={recent()}>
          {(s) => (
            <text>
              <span style={{ fg: T.accent }}>{s.id.slice(0, 8)}</span>
              <span style={{ fg: T.dim }}> {humanDate(s.updatedAt).padEnd(10)}</span>
              <span style={{ fg: T.cyan }}>{s.project.padEnd(18).slice(0, 18)}</span>
              <span style={{ fg: T.fg }}> {(s.title ?? "(untitled)").slice(0, 60)}</span>
            </text>
          )}
        </For>
      </box>
    </box>
  )
}

function Kpi(props: { label: string; value: string; color: string }) {
  return (
    <box
      border
      borderStyle="single"
      borderColor={T.border}
      paddingX={1}
      flexDirection="column"
      flexShrink={0}
      height={4}
    >
      <text>
        <span style={{ fg: T.dim }}>{props.label}</span>
      </text>
      <text>
        <span style={{ fg: props.color }}>
          <strong>{props.value}</strong>
        </span>
      </text>
    </box>
  )
}
