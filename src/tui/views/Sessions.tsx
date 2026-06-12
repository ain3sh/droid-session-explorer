import { createMemo, createSignal, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { listSessions } from "../../query/sessions"
import { humanDate, humanTokens } from "../../cli/format"
import { useApp } from "../state"
import { T } from "../theme"

export function Sessions() {
  const app = useApp()
  const [filter, setFilter] = createSignal("")
  const [editing, setEditing] = createSignal(false)
  const [selectedIndex, setSelectedIndex] = createSignal(0)

  onMount(() => app.setInputActive(false))

  const sessions = createMemo(() =>
    listSessions(app.ctx.db, {
      query: filter() || undefined,
      includeSubagents: true,
      includeExec: true,
      limit: 200,
    }),
  )

  const options = createMemo(() =>
    sessions().map((s) => ({
      name: `${s.id.slice(0, 8)}  ${humanDate(s.updatedAt).padEnd(10)} ${s.project
        .padEnd(20)
        .slice(0, 20)} ${(s.title ?? "(untitled)").slice(0, 52)}`,
      description: `${s.counts.messages} msgs · ${humanTokens(s.usage.credits)} credits · ${s.model ?? "?"}${
        s.isSubagent ? " · subagent" : ""
      }${s.isExec ? " · exec" : ""}${s.forkParent ? " · fork" : ""}`,
      value: s.id,
    })),
  )

  useKeyboard((key) => {
    if (editing()) {
      if (key.name === "escape" || key.name === "return") {
        // Unfocus next tick so the closing keypress is not also delivered to
        // the re-focused list behind the input or the global key handler.
        setTimeout(() => {
          setEditing(false)
          app.setInputActive(false)
        }, 0)
      }
      return
    }
    const seq = key.sequence ?? key.name
    if (seq === "/") {
      app.setInputActive(true)
      setTimeout(() => setEditing(true), 0)
      return
    }
    const current = sessions()[selectedIndex()]
    if (!current) return
    if (seq === "t") {
      app.openTree(current.id)
    } else if (seq === "r") {
      const cmd = current.cwd
        ? `cd '${current.cwd}' && droid --resume ${current.id}`
        : `droid --resume ${current.id}`
      app.quit(cmd)
    }
  })

  return (
    <box flexDirection="column" flexGrow={1} padding={1} gap={0}>
      <box height={1} flexDirection="row" gap={1}>
        <text>
          <span style={{ fg: editing() ? T.yellow : T.dim }}>filter:</span>
        </text>
        <input
          value={filter()}
          onInput={(v: string) => {
            setFilter(v)
            setSelectedIndex(0)
          }}
          placeholder="fuzzy title filter (press / to edit)"
          focused={editing()}
          flexGrow={1}
        />
        <text>
          <span style={{ fg: T.dim }}>{`${sessions().length} sessions`}</span>
        </text>
      </box>
      <select
        options={options()}
        onChange={(index: number) => setSelectedIndex(index)}
        onSelect={(_i: number, option: { value?: string } | null) => {
          if (option?.value) app.openTranscript(option.value)
        }}
        focused={!editing()}
        flexGrow={1}
        showDescription
      />
    </box>
  )
}
