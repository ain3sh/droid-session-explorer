import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SESSION = "abababab-1111-2222-3333-444444444444"
const ENTRY = join(import.meta.dir, "..", "src", "index.ts")

let root: string
let env: Record<string, string>

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "dsx-stdout-test-"))
  const slugDir = join(root, "sessions", "-home-test-big")
  mkdirSync(slugDir, { recursive: true })
  const records = [
    { type: "session_start", id: SESSION, title: "big", cwd: "/home/test/big", version: 2 },
    {
      type: "message",
      id: "m1",
      timestamp: "2026-06-01T10:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "word ".repeat(60_000) }] },
    },
  ]
  writeFileSync(
    join(slugDir, `${SESSION}.jsonl`),
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
  )
  env = {
    ...(process.env as Record<string, string>),
    DROID_SESSION_ROOT: join(root, "sessions"),
    DSX_DB_PATH: join(root, "index.db"),
    DSX_DATA_DIR: join(root, "data"),
  }
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

// A shell pipe gives the kernel's 64 KiB pipe buffer. Bun.spawn's own stdout
// buffers far more (768 KiB on macOS), which would hide the bug at this size.
function pipedBytes(args: string[]): number {
  const cmd = `"${process.execPath}" "${ENTRY}" ${args.join(" ")} | wc -c`
  const proc = Bun.spawnSync(["sh", "-c", cmd], { env, stderr: "pipe" })
  expect(proc.exitCode).toBe(0)
  return Number(proc.stdout.toString().trim())
}

describe("stdout through a pipe", () => {
  test("export delivers every byte past the 64 KiB pipe buffer", () => {
    const outFile = join(root, "export.md")
    const written = Bun.spawnSync(
      [process.execPath, ENTRY, "export", SESSION, "-o", outFile],
      { env, stderr: "pipe" },
    )
    expect(written.exitCode).toBe(0)
    const fileBytes = readFileSync(outFile).byteLength
    expect(fileBytes).toBeGreaterThan(256 * 1024)

    expect(pipedBytes(["--no-refresh", "export", SESSION])).toBe(fileBytes + 1)
  })

  test("export exits 0 quietly when the reader closes early", () => {
    const status = join(root, "status")
    const stderr = join(root, "stderr")
    // A group writes dsx's own exit status to a file; POSIX sh has no pipefail.
    const cmd = `{ "${process.execPath}" "${ENTRY}" export ${SESSION} 2>"${stderr}"; echo $? >"${status}"; } | head -c 100 >/dev/null`
    expect(Bun.spawnSync(["sh", "-c", cmd], { env }).exitCode).toBe(0)
    expect(readFileSync(stderr, "utf8")).toBe("")
    expect(readFileSync(status, "utf8").trim()).toBe("0")
  })
})
