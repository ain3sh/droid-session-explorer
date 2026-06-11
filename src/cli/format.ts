import pc from "picocolors"

export function humanTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function humanDuration(ms: number): string {
  if (ms <= 0) return "-"
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${s % 60 ? ` ${s % 60}s` : ""}`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`
}

export function humanDate(ms: number | null): string {
  if (ms === null) return "-"
  const d = new Date(ms)
  const now = Date.now()
  const diff = now - ms
  if (diff < 60_000) return "just now"
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return d.toISOString().slice(0, 10)
}

export function isoDate(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString()
}

/**
 * Parse human time refs: "7d", "24h", "30m", "2026-05-01", "2026-05-01T10:00".
 * Returns ms epoch.
 */
export function parseWhen(input: string): number {
  const rel = /^(\d+(?:\.\d+)?)([mhdw])$/.exec(input.trim())
  if (rel) {
    const n = Number(rel[1])
    const unit = { m: 60_000, h: 3600_000, d: 86_400_000, w: 7 * 86_400_000 }[
      rel[2] as "m" | "h" | "d" | "w"
    ]!
    return Date.now() - n * unit
  }
  const abs = Date.parse(input)
  if (!Number.isNaN(abs)) return abs
  throw new Error(`cannot parse time '${input}' (try 7d, 24h, or 2026-05-01)`)
}

export interface Column<T> {
  header: string
  value: (row: T) => string
  align?: "left" | "right"
  color?: (s: string, row: T) => string
}

const ANSI_RE = /\x1b\[[0-9;]*m/g
const width = (s: string) => s.replace(ANSI_RE, "").length

/** Minimal ANSI-aware column table. */
export function renderTable<T>(rows: T[], columns: Column<T>[]): string {
  const cells = rows.map((row) =>
    columns.map((col) => {
      const raw = col.value(row)
      return col.color ? col.color(raw, row) : raw
    }),
  )
  const widths = columns.map((col, i) =>
    Math.max(width(col.header), ...cells.map((r) => width(r[i]!))),
  )
  const pad = (s: string, w: number, right: boolean) => {
    const fill = " ".repeat(Math.max(0, w - width(s)))
    return right ? fill + s : s + fill
  }
  const header = columns
    .map((c, i) => pc.bold(pc.dim(pad(c.header, widths[i]!, c.align === "right"))))
    .join("  ")
  const body = cells.map((r) =>
    r.map((cell, i) => pad(cell, widths[i]!, columns[i]!.align === "right")).join("  "),
  )
  return [header, ...body].join("\n")
}

/** Print data as JSON (stable contract) or via a human renderer. */
export function output(json: boolean, data: unknown, human: () => string): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2))
  } else {
    console.log(human())
  }
}

export function fail(message: string): never {
  console.error(pc.red(`dsx: ${message}`))
  process.exit(1)
}

const BLOCKS = ["\u00b7", "\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"]

export function sparkline(values: number[]): string {
  const max = Math.max(...values, 1)
  return values
    .map((v) => (v <= 0 ? BLOCKS[0] : BLOCKS[Math.min(8, Math.max(1, Math.ceil((v / max) * 8)))]))
    .join("")
}

/** GitHub-style contribution heatmap colors for terminal */
export function heatChar(value: number, max: number): string {
  if (value <= 0) return pc.dim("\u00b7")
  const level = Math.min(4, Math.max(1, Math.ceil((value / max) * 4)))
  const block = "\u25a0"
  switch (level) {
    case 1:
      return pc.green(pc.dim(block))
    case 2:
      return pc.green(block)
    case 3:
      return pc.bold(pc.green(block))
    default:
      return pc.bgGreen(pc.black(block))
  }
}

export const SNIPPET_OPEN = "\u0001"
export const SNIPPET_CLOSE = "\u0002"

/** Convert FTS snippet sentinels into terminal highlights (or plain markers). */
export function renderSnippet(snippet: string, colorize = true): string {
  const clean = snippet.replaceAll("\n", " ")
  if (!colorize) {
    return clean.replaceAll(SNIPPET_OPEN, "[").replaceAll(SNIPPET_CLOSE, "]")
  }
  return clean
    .replaceAll(SNIPPET_OPEN, "\x1b[1;33m")
    .replaceAll(SNIPPET_CLOSE, "\x1b[0m")
}
