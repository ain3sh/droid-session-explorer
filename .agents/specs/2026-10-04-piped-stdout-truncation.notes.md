# Piped stdout cut at 64 KiB — implementation notes

- Symptom: `dsx export <id> | wc -c` stopped at exactly 65,537 bytes, and
  `list --json`, `search --json` at 65,536, exit 0. `-o` and `> file` were
  complete. Not an exit race: nothing calls `process.exit()` on the success
  path, and a 2 s sleep after the write still loses the tail.
- Cause is Bun (oven-sh/bun#36419, fix pending in #37128): once
  `process.stdout` is materialised, fd 1 goes non-blocking and `console.log`
  makes one `write(2)`, dropping whatever the pipe buffer refuses.
  `picocolors` touches `process.stdout.isTTY` on import, so every CLI command
  is affected. Minimal repro:
  `bun -e "process.stdout; console.log('x'.repeat(1e6))" | wc -c` → 65536.
- `process.stdout.write` retries and keeps the loop alive until drained, so
  data output goes through `println` in `src/cli/format.ts` (used by `output`,
  `export`, `insights --deep --json`). Short status lines (`sync`,
  `maintenance`, `path`, `resume`) still use `console.log`; they stay far
  below the buffer.
- `process.stdout.write` reports a reader that closed early (`| head`) as an
  `EPIPE` error event, which would crash with exit 1; `src/index.ts` exits 0
  quietly on `EPIPE` and rethrows any other stdout error.
- The regression test pipes through `sh -c '... | wc -c'`: `Bun.spawn`'s own
  stdout pipe buffers ~768 KiB on macOS and hides the bug at test sizes.
