/**
 * Minimal stream-jsonrpc client for `droid exec`.
 *
 * Spawns droid as a subprocess, drives one turn over newline-delimited
 * JSON-RPC on stdin/stdout, streams assistant text deltas, and resolves when
 * the working state returns to idle. Protocol per the droid TypeScript SDK
 * (Factory-AI/droid-sdk-typescript, src/schemas).
 */

export interface DroidTurnOptions {
  prompt: string
  cwd: string
  model?: string
  reasoningEffort?: string
  /** Plain tag names attached to the spawned session. */
  tags?: string[]
  timeoutMs?: number
  signal?: AbortSignal
  onDelta?: (text: string) => void
  onStatus?: (status: string) => void
}

export interface DroidTurnResult {
  text: string
  /** Session id of the spawned droid exec run (tagged `exec`, hidden from dsx reports). */
  execSessionId: string | null
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000

/**
 * Factory's JSON-RPC envelope: standard 2.0 fields plus a required message
 * `type` discriminator, string ids, and a legacy `factoryApiVersion` literal.
 */
interface JsonRpcMessage {
  jsonrpc?: string
  type?: "request" | "response" | "notification"
  factoryApiVersion?: string
  id?: string | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code?: number; message?: string }
}

export async function runDroidTurn(opts: DroidTurnOptions): Promise<DroidTurnResult> {
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">
  try {
    proc = Bun.spawn(
      ["droid", "exec", "--input-format", "stream-jsonrpc", "--output-format", "stream-jsonrpc"],
      { cwd: opts.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    )
  } catch (e) {
    throw new Error(
      `cannot spawn droid (${e instanceof Error ? e.message : String(e)}); is the droid CLI installed and on PATH?`,
    )
  }

  const send = (msg: JsonRpcMessage) => {
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", factoryApiVersion: "1.0.0", ...msg })}\n`)
    proc.stdin.flush()
  }

  let nextId = 1
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const request = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = `dsx-${nextId++}`
      pending.set(id, { resolve, reject })
      send({ type: "request", id, method, params })
    })

  let text = ""
  let busy = false
  let settled = false
  let resolveTurn!: () => void
  let rejectTurn!: (e: Error) => void
  const turn = new Promise<void>((res, rej) => {
    resolveTurn = () => {
      settled = true
      res()
    }
    rejectTurn = (e) => {
      settled = true
      rej(e)
    }
  })

  const handleNotification = (n: Record<string, unknown>) => {
    switch (n.type) {
      case "assistant_text_delta": {
        const delta = typeof n.textDelta === "string" ? n.textDelta : ""
        text += delta
        opts.onDelta?.(delta)
        break
      }
      case "tool_call": {
        const toolUse = n.toolUse as { name?: string } | undefined
        opts.onStatus?.(`running ${toolUse?.name ?? "tool"}`)
        break
      }
      case "error": {
        opts.onStatus?.(`droid error: ${typeof n.message === "string" ? n.message : "unknown"}`)
        break
      }
      case "droid_working_state_changed": {
        if (n.newState !== "idle") {
          busy = true
          opts.onStatus?.(String(n.newState).replaceAll("_", " "))
        } else if (busy) {
          resolveTurn()
        }
        break
      }
    }
  }

  const handleMessage = (msg: JsonRpcMessage) => {
    if (msg.type === "response") {
      if (msg.id == null) {
        // Server could not associate the error with a request (e.g. parse error).
        if (msg.error) rejectTurn(new Error(`droid rpc: ${msg.error.message ?? "invalid message"}`))
        return
      }
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(msg.error.message ?? "droid rpc error"))
      else entry.resolve(msg.result)
      return
    }
    if (msg.method === "droid.session_notification") {
      const n = (msg.params as { notification?: Record<string, unknown> } | undefined)?.notification
      if (n) handleNotification(n)
      return
    }
    // Server-to-client requests: this is an unattended run, so anything the
    // low autonomy level does not auto-approve gets declined.
    if (msg.method === "droid.request_permission" && msg.id != null) {
      send({
        type: "response",
        id: msg.id,
        result: { selectedOption: "cancel", comment: "dsx runs unattended; permission denied" },
      })
      return
    }
    if (msg.method === "droid.ask_user" && msg.id != null) {
      send({ type: "response", id: msg.id, result: { cancelled: true, answers: [] } })
    }
  }

  const readLoop = (async () => {
    const decoder = new TextDecoder()
    let buf = ""
    for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk, { stream: true })
      let idx: number
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line.startsWith("{")) continue
        try {
          handleMessage(JSON.parse(line) as JsonRpcMessage)
        } catch {
          // non-JSON noise on stdout: ignore
        }
      }
    }
  })()

  const stderrTail = (async () => {
    let tail = ""
    const decoder = new TextDecoder()
    for await (const chunk of proc.stderr) {
      tail = (tail + decoder.decode(chunk, { stream: true })).slice(-2000)
    }
    return tail.trim()
  })()

  const timeout = setTimeout(() => {
    rejectTurn(new Error(`droid exec timed out after ${Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 60_000)}m`))
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  const onAbort = () => rejectTurn(new Error("cancelled"))
  opts.signal?.addEventListener("abort", onAbort, { once: true })

  proc.exited.then(async (code) => {
    if (settled) return
    const tail = await stderrTail.catch(() => "")
    rejectTurn(new Error(`droid exec exited early (code ${code})${tail ? `: ${tail.split("\n").at(-1)}` : ""}`))
  })

  let execSessionId: string | null = null
  try {
    const init = (await Promise.race([
      request("droid.initialize_session", {
        machineId: "dsx",
        cwd: opts.cwd,
        ...(opts.model ? { modelId: opts.model } : {}),
        ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
        interactionMode: "auto",
        autonomyLevel: "low",
        ...(opts.tags?.length ? { tags: opts.tags.map((name) => ({ name })) } : {}),
      }),
      turn.then(() => {
        throw new Error("droid exec ended before session initialization")
      }),
    ])) as { sessionId?: string } | null
    execSessionId = init?.sessionId ?? null
    opts.onStatus?.("session initialized")

    request("droid.add_user_message", { text: opts.prompt }).catch((e: Error) => rejectTurn(e))
    await turn
    return { text, execSessionId }
  } finally {
    clearTimeout(timeout)
    opts.signal?.removeEventListener("abort", onAbort)
    for (const entry of pending.values()) entry.reject(new Error("droid exec connection closed"))
    pending.clear()
    try {
      send({ type: "request", id: `dsx-${nextId++}`, method: "droid.close_session", params: {} })
      proc.stdin.end()
    } catch {
      // stdin already gone
    }
    const killTimer = setTimeout(() => proc.kill("SIGKILL"), 3000)
    proc.kill()
    await proc.exited.catch(() => {})
    clearTimeout(killTimer)
    await readLoop.catch(() => {})
  }
}
