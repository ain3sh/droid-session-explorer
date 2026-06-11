import pc from "picocolors"
import type { AppContext } from "../context"

/**
 * Bring the index up to date before answering a query. Progress goes to
 * stderr only when there is meaningful work (first index, big backlog).
 */
export async function ensureFresh(ctx: AppContext, skip = false): Promise<void> {
  if (skip) return
  let announced = false
  const started = performance.now()
  const result = await ctx.refresh((done, total, path) => {
    if (!announced && total > 5) {
      console.error(pc.dim(`dsx: indexing ${total} changed files...`))
      announced = true
    }
    if (announced && done > 0 && done % 200 === 0) {
      console.error(pc.dim(`dsx: ${done}/${total} (${path.split("/").pop()})`))
    }
  })
  if (announced) {
    const secs = ((performance.now() - started) / 1000).toFixed(1)
    console.error(
      pc.dim(
        `dsx: indexed ${result.transcriptsIngested} transcripts, ${result.settingsIngested} settings (${result.linesParsed} lines) in ${secs}s`,
      ),
    )
  }
}
