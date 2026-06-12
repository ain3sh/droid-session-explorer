# AGENTS.md

Guidance for coding agents working in this repo.

## Project shape

- Bun + TypeScript. CLI entry `src/index.ts` (commander), TUI in `src/tui/`
  (OpenTUI Solid, JSX via `@opentui/solid`), indexer/query layers in
  `src/indexer/` and `src/query/`.
- The index DB lives at `~/.cache/dsx/index.db`, never in the repo.
- `dist/` is gitignored build output.

## Verify before committing

```bash
bun test            # fixture-based indexer/query tests
bunx tsc --noEmit   # typecheck
bun run build       # dev bundle (dist/index.js, used by `bun link`)
bun run compile     # host-platform SEA (dist/dsx-<target>), smoke test it:
./dist/dsx-* --no-refresh list -n 2
```

For TUI changes, test the actual terminal behavior (e.g. with tuistory):
launch `bun run dev` or the compiled binary with `tui`, exercise the views,
confirm clean exit.

## Cutting a release

Releases are SEA binaries built by CI on `v*` tags and attached to a GitHub
Release. Users install via `install.sh` (curl | bash), which defaults to the
latest release.

1. Make sure `main` is green: `bun test && bunx tsc --noEmit`.
2. Bump `version` in `package.json` and the `.version()` string in
   `src/cli/program.ts` (keep them in sync).
3. Commit and push to `main`.
4. Tag and push the tag; this triggers `.github/workflows/release.yml`:

   ```bash
   git tag v0.x.y
   git push origin v0.x.y
   ```

   Pushing requires an account with write access to
   `ain3sh/droid-session-explorer`; switch with `gh auth switch` if the active
   account lacks access (and switch back afterwards).

   If (and only if) the user you are working with is Ainesh (the project is
   OSS, so check): wrap every push as
   `gh auth switch --user ain3sh` → push → `gh auth switch --user factory-ain3sh`.

5. Watch the run and confirm all four assets land:

   ```bash
   gh run watch --repo ain3sh/droid-session-explorer $(gh run list --repo ain3sh/droid-session-explorer -L 1 --json databaseId -q '.[0].databaseId') --exit-status
   gh release view v0.x.y --repo ain3sh/droid-session-explorer --json assets -q '.assets[].name'
   ```

   Expected: `dsx-{linux,darwin}-{x64,arm64}.tar.gz`.

6. Smoke test the published artifact end to end:

   ```bash
   DSX_INSTALL_DIR=/tmp/dsx-rel-test bash -c 'curl -fsSL https://raw.githubusercontent.com/ain3sh/droid-session-explorer/main/install.sh | bash'
   /tmp/dsx-rel-test/dsx --version && rm -rf /tmp/dsx-rel-test
   ```

### Release gotchas

- **Bad tag before release exists**: if CI fails on the tag, fix on `main`,
  then move the tag: `git tag -d v0.x.y && git push origin :refs/tags/v0.x.y`,
  retag, repush. Never move a tag that already has a published release; cut a
  new patch version instead.
- **raw.githubusercontent.com caches ~5 min**: right after changing
  `install.sh`, test with a commit-pinned URL
  (`.../droid-session-explorer/<sha>/install.sh`) instead of `main`.
- **macOS runners**: Intel builds use `macos-15-intel` (`macos-13` is retired
  and queues forever). arm64 uses `macos-latest`.
- **SEA bundling**: `scripts/compile.ts` must keep using the
  `@opentui/solid/bun-plugin` so solid-js resolves to its client build and the
  OpenTUI native renderer is embedded. Do not add `external` to the compile
  build. Smoke test the TUI in the compiled binary, not just the CLI.

## Conventions

- All CLI query commands support `--json` with stable shapes; treat those
  shapes as a public contract (the companion skill in `skills/dsx/` documents
  them).
- Errors to stderr, data to stdout.
- Implementation decisions and surprises are logged in
  `.agents/specs/*.notes.md`; append there when you hit something non-obvious.
- LLM-powered features (`dsx ask`, `dsx insights --deep`) go through
  `src/exec/`: `droid.ts` drives `droid exec` over stream-jsonrpc, sub-droids
  get the embedded cheatsheet from `cheatsheet.ts` (keep it in sync with
  `skills/dsx/SKILL.md`). Spawned runs are auto-tagged `exec` by droid, so
  they stay out of dsx's own reports.

## Next ideas

- TUI-native chat pane ("ask your sessions" inside the dashboard): build on
  the official droid TypeScript SDK rather than our raw stream-jsonrpc client,
  but wait until the in-flight SDK rewrite lands.
