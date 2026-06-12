import { createMemo, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { insightsReport } from "../../query/insights"
import {
  cachedDeepInsights,
  generateDeepInsights,
  type DeepInsights,
} from "../../exec/deepInsights"
import { humanDate, parseWhen } from "../../cli/format"
import { useApp } from "../state"
import { T } from "../theme"

const WINDOWS = [null, "7d", "30d", "90d"] as const
const EFFORTS = ["low", "medium", "high"] as const

export function Insights() {
  const app = useApp()

  const [win, setWin] = createSignal<(typeof WINDOWS)[number]>(null)
  const [project, setProject] = createSignal("")
  const [model, setModel] = createSignal(app.ctx.config.insightsModel)
  const [reasoning, setReasoning] = createSignal(app.ctx.config.insightsReasoning)
  const [editing, setEditing] = createSignal<null | "model" | "project">(null)

  const [mode, setMode] = createSignal<"findings" | "brief">("findings")
  const [brief, setBrief] = createSignal<DeepInsights | null>(cachedDeepInsights(app.ctx.db))
  const [streamed, setStreamed] = createSignal("")
  const [running, setRunning] = createSignal(false)

  const since = createMemo(() => {
    const w = win()
    return w ? parseWhen(w) : undefined
  })

  const report = createMemo(() =>
    insightsReport(app.ctx.db, {
      limit: 100,
      project: project() || undefined,
      since: since(),
    }),
  )

  let abort: AbortController | null = null
  onCleanup(() => abort?.abort())

  const generate = () => {
    if (running()) return
    setMode("brief")
    setRunning(true)
    setStreamed("")
    app.setStatus("deep brief: starting droid exec...")
    abort = new AbortController()
    generateDeepInsights(app.ctx, {
      model: model() || undefined,
      reasoningEffort: reasoning(),
      project: project() || undefined,
      since: since(),
      signal: abort.signal,
      onDelta: (t) => setStreamed((s) => s + t),
      onStatus: (s) => app.setStatus(`deep brief: ${s}`),
    })
      .then((result) => {
        setBrief(result)
        app.setStatus(`deep brief ready (${result.model})`)
      })
      .catch((e: Error) => app.setStatus(`deep brief failed: ${e.message}`))
      .finally(() => setRunning(false))
  }

  useKeyboard((key) => {
    if (editing()) {
      if (key.name === "escape" || key.name === "return") {
        // Unfocus next tick so the closing keypress is not also delivered to
        // the re-focused list behind the input or the global key handler.
        setTimeout(() => {
          setEditing(null)
          app.setInputActive(false)
        }, 0)
      }
      return
    }
    if (app.inputActive()) return
    const seq = key.sequence ?? key.name
    if (seq === "g") {
      generate()
    } else if (seq === "d") {
      setMode((m) => (m === "brief" ? "findings" : "brief"))
    } else if (seq === "w") {
      setWin((w) => WINDOWS[(WINDOWS.indexOf(w) + 1) % WINDOWS.length]!)
    } else if (seq === "e") {
      setReasoning(
        (r) => EFFORTS[(EFFORTS.indexOf(r as (typeof EFFORTS)[number]) + 1) % EFFORTS.length]!,
      )
    } else if (seq === "m" || seq === "p") {
      // Focus next tick so the triggering keypress is not typed into the input.
      const field = seq === "m" ? "model" : "project"
      app.setInputActive(true)
      setTimeout(() => setEditing(field), 0)
    }
  })

  const options = createMemo(() =>
    report().insights.map((i) => ({
      name: `[${i.kind.padEnd(16)}] ${i.session.id.slice(0, 8)}  ${(
        i.session.title ?? "(untitled)"
      ).slice(0, 55)}`,
      description: `${i.detail} · ${i.session.project} · ${humanDate(i.session.updatedAt)}`,
      value: i.session.id,
    })),
  )

  const briefText = createMemo(() => {
    if (running()) return streamed() || "waiting for first tokens..."
    return brief()?.narrative ?? ""
  })

  const briefProvenance = createMemo(() => {
    const b = brief()
    if (!b) return "deep brief"
    const win = b.filters.since
      ? ` · since ${new Date(b.filters.since).toISOString().slice(0, 10)}`
      : ""
    const proj = b.filters.project ? ` · ${b.filters.project}` : ""
    return `deep brief · ${b.model}${win}${proj} · ${humanDate(b.generatedAt)}`
  })

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box height={1} flexDirection="row" gap={3}>
        <text>
          <span style={{ fg: T.dim }}>tool error rate </span>
          <span style={{ fg: T.red }}>{`${(report().overall.toolErrorRate * 100).toFixed(1)}%`}</span>
        </text>
        <text>
          <span style={{ fg: T.dim }}>interruption rate </span>
          <span style={{ fg: T.yellow }}>{`${(report().overall.interruptionRate * 100).toFixed(1)}%`}</span>
        </text>
        <text>
          <span style={{ fg: T.dim }}>sessions </span>
          <span style={{ fg: T.accent }}>{String(report().overall.sessions)}</span>
        </text>
        <text>
          <Show
            when={mode() === "brief"}
            fallback={<span style={{ fg: T.dim }}>findings · g: deep brief</span>}
          >
            <span style={{ fg: T.magenta }}>
              {running() ? "deep brief: generating..." : briefProvenance()}
            </span>
          </Show>
        </text>
      </box>
      <box height={1} flexDirection="row" gap={2}>
        <text>
          <span style={{ fg: T.dim }}>w:window </span>
          <span style={{ fg: T.cyan }}>{win() ?? "all"}</span>
        </text>
        <text>
          <span style={{ fg: editing() === "project" ? T.yellow : T.dim }}>p:project </span>
        </text>
        <input
          value={project()}
          onInput={setProject}
          placeholder="all"
          focused={editing() === "project"}
          width={18}
        />
        <text>
          <span style={{ fg: editing() === "model" ? T.yellow : T.dim }}>m:model </span>
        </text>
        <input
          value={model()}
          onInput={setModel}
          placeholder={app.ctx.config.insightsModel}
          focused={editing() === "model"}
          width={24}
        />
        <text>
          <span style={{ fg: T.dim }}>e:effort </span>
          <span style={{ fg: T.cyan }}>{reasoning()}</span>
        </text>
      </box>
      <Switch>
        <Match when={mode() === "findings"}>
          <select
            options={options()}
            onSelect={(_i: number, option: { value?: string } | null) => {
              if (option?.value) app.openTranscript(option.value)
            }}
            focused={!editing()}
            flexGrow={1}
            showDescription
          />
        </Match>
        <Match when={mode() === "brief"}>
          <scrollbox focused={!editing()} flexGrow={1} paddingX={1}>
            <Show
              when={briefText()}
              fallback={
                <text>
                  <span style={{ fg: T.dim }}>
                    no brief yet. press g to have a sub-droid mine your sessions and write one.
                  </span>
                </text>
              }
            >
              <text selectable fg={T.fg}>
                {briefText()}
              </text>
            </Show>
          </scrollbox>
        </Match>
      </Switch>
    </box>
  )
}
