import { createCliRenderer } from "@opentui/core"
import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { Match, Show, Switch } from "solid-js"
import pc from "picocolors"
import type { AppContext } from "../context"
import { ensureFresh } from "../cli/refresh"
import { AppStateProvider, createAppState, useApp, type View } from "./state"
import { T } from "./theme"
import { Dashboard } from "./views/Dashboard"
import { Sessions } from "./views/Sessions"
import { SearchView } from "./views/Search"
import { Insights } from "./views/Insights"
import { StatsView } from "./views/Stats"
import { TranscriptView } from "./views/Transcript"
import { TreeView } from "./views/TreeView"

const TABS: Array<{ key: string; view: View; label: string }> = [
  { key: "1", view: "dashboard", label: "dashboard" },
  { key: "2", view: "sessions", label: "sessions" },
  { key: "3", view: "search", label: "search" },
  { key: "4", view: "stats", label: "stats" },
  { key: "5", view: "insights", label: "insights" },
]

export async function launchTui(ctx: AppContext): Promise<void> {
  await ensureFresh(ctx)

  let resumeCommand: string | undefined
  let resolveExit!: () => void
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
  })

  const renderer = await createCliRenderer({ exitOnCtrlC: false })
  const state = createAppState(ctx, (cmd) => {
    resumeCommand = cmd
    renderer.destroy()
    resolveExit()
  })

  render(
    () => (
      <AppStateProvider value={state}>
        <App />
      </AppStateProvider>
    ),
    renderer,
  )

  await exited
  if (resumeCommand) {
    console.log(pc.dim("run this to resume:"))
    console.log(resumeCommand)
  }
}

function App() {
  const app = useApp()
  const renderer = useRenderer()

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      app.quit()
      return
    }
    if (app.inputActive()) return
    const seq = key.sequence ?? key.name
    if (seq === "q") {
      app.quit()
      return
    }
    const tab = TABS.find((t) => t.key === seq)
    if (tab) {
      app.setView(tab.view)
      return
    }
    if (key.name === "escape") app.back()
  })

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={T.bg}>
      <Header />
      <box flexGrow={1} flexDirection="column">
        <Switch>
          <Match when={app.view() === "dashboard"}>
            <Dashboard />
          </Match>
          <Match when={app.view() === "sessions"}>
            <Sessions />
          </Match>
          <Match when={app.view() === "search"}>
            <SearchView />
          </Match>
          <Match when={app.view() === "stats"}>
            <StatsView />
          </Match>
          <Match when={app.view() === "insights"}>
            <Insights />
          </Match>
          <Match when={app.view() === "transcript"}>
            <TranscriptView />
          </Match>
          <Match when={app.view() === "tree"}>
            <TreeView />
          </Match>
        </Switch>
      </box>
      <Footer />
    </box>
  )
}

function Header() {
  const app = useApp()
  return (
    <box
      flexDirection="row"
      paddingX={1}
      gap={2}
      backgroundColor={T.bgAlt}
      height={1}
    >
      <text>
        <span style={{ fg: T.accent }}>
          <strong>dsx</strong>
        </span>
      </text>
      {TABS.map((tab) => (
        <text>
          <Show
            when={app.view() === tab.view}
            fallback={
              <span style={{ fg: T.dim }}>
                {tab.key}:{tab.label}
              </span>
            }
          >
            <span style={{ fg: T.bg, bg: T.accent }}>
              {` ${tab.key}:${tab.label} `}
            </span>
          </Show>
        </text>
      ))}
      <Show when={app.view() === "transcript" || app.view() === "tree"}>
        <text>
          <span style={{ fg: T.yellow }}>{app.view()}</span>
        </text>
      </Show>
    </box>
  )
}

function Footer() {
  const app = useApp()
  const hints = () => {
    switch (app.view()) {
      case "sessions":
        return "/ filter  enter open  t tree  r resume+quit  esc back  q quit"
      case "search":
        return "/ edit query  enter open hit  esc back  q quit"
      case "transcript":
        return "j/k scroll  [/] page  t thinking  o tool output  y yank id  r resume+quit  esc back"
      case "tree":
        return "enter open transcript  esc back  q quit"
      case "insights":
        return "g generate brief  d findings/brief  w window  e effort  m model  p project  enter open  esc back"
      default:
        return "1-5 views  enter select  esc back  q quit"
    }
  }
  return (
    <box flexDirection="row" paddingX={1} height={1} backgroundColor={T.bgAlt}>
      <text>
        <span style={{ fg: T.dim }}>{app.status() || hints()}</span>
      </text>
    </box>
  )
}
