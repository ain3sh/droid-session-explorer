import solidPlugin from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  packages: "external",
  banner: "#!/usr/bin/env bun",
  plugins: [solidPlugin],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const out = result.outputs[0]
if (out) {
  const { chmod } = await import("node:fs/promises")
  await chmod(out.path, 0o755)
}
console.log("built dist/index.js")
