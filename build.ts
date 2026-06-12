import solidPlugin from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  // solid-js and @opentui/solid must be bundled so the plugin can redirect
  // solid-js to its client build; everything else stays external.
  external: ["@opentui/core", "commander", "picocolors"],
  // skills/dsx/references/*.md are embedded as the sub-droid cheatsheet.
  loader: { ".md": "text" },
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
