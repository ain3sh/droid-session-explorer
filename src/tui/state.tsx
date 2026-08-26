import { createContext, createSignal, useContext, type Accessor } from "solid-js"
import type { AppContext } from "../context"

export type View =
  | "dashboard"
  | "sessions"
  | "search"
  | "insights"
  | "stats"
  | "transcript"
  | "tree"

export interface AppState {
  ctx: AppContext
  view: Accessor<View>
  setView: (v: View) => void
  selectedSession: Accessor<string | null>
  openTranscript: (sessionId: string) => void
  openTree: (sessionId: string) => void
  back: () => void
  /** True while a text input owns the keyboard */
  inputActive: Accessor<boolean>
  setInputActive: (b: boolean) => void
  quit: (resumeCommand?: string) => void
  status: Accessor<string>
  setStatus: (s: string) => void
  /** Bumped when the background refresh lands new data; query memos depend on it. */
  dataVersion: Accessor<number>
  bumpDataVersion: () => void
}

const Ctx = createContext<AppState>()

export function useApp(): AppState {
  const state = useContext(Ctx)
  if (!state) throw new Error("AppState context missing")
  return state
}

export function createAppState(
  ctx: AppContext,
  onQuit: (resumeCommand?: string) => void,
): AppState {
  const [view, setViewRaw] = createSignal<View>("dashboard")
  const [selectedSession, setSelectedSession] = createSignal<string | null>(null)
  const [inputActive, setInputActive] = createSignal(false)
  const [status, setStatus] = createSignal("")
  const [history, setHistory] = createSignal<View[]>([])
  const [dataVersion, setDataVersion] = createSignal(0)

  // View switches are deferred a tick so the keypress that triggered the
  // switch is not also delivered to a freshly-mounted focused input.
  const setView = (v: View) => {
    if (v === view()) return
    setHistory((h) => [...h, view()])
    setStatus("")
    setTimeout(() => setViewRaw(v), 0)
  }

  return {
    ctx,
    view,
    setView,
    selectedSession,
    openTranscript: (id) => {
      setSelectedSession(id)
      setView("transcript")
    },
    openTree: (id) => {
      setSelectedSession(id)
      setView("tree")
    },
    back: () => {
      const h = history()
      if (h.length === 0) return
      setHistory(h.slice(0, -1))
      setStatus("")
      setTimeout(() => setViewRaw(h[h.length - 1]!), 0)
    },
    inputActive,
    setInputActive,
    quit: onQuit,
    status,
    setStatus,
    dataVersion,
    bumpDataVersion: () => setDataVersion((v) => v + 1),
  }
}

export const AppStateProvider = Ctx.Provider
