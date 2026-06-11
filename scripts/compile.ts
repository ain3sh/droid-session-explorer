/**
 * Compile dsx into a single self-contained executable.
 * Usage: bun scripts/compile.ts [bun-linux-x64|bun-linux-arm64|bun-darwin-x64|bun-darwin-arm64] [outfile]
 * Defaults to the host platform.
 */
import solidPlugin from "@opentui/solid/bun-plugin"

const target = (process.argv[2] ?? hostTarget()) as Bun.Build.Target
const outfile = process.argv[3] ?? `dist/dsx-${String(target).replace(/^bun-/, "")}`

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  target: "bun",
  plugins: [solidPlugin],
  compile: {
    target,
    outfile,
  },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log(`compiled ${outfile} (${target})`)

function hostTarget(): string {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux"
  const arch = process.arch === "arm64" ? "arm64" : "x64"
  return `bun-${os}-${arch}`
}
