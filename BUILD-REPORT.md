# fileport — Build Report

Wave 1, Batch 2, MCP Rebuild 100. Clean-room rebuild of the
"filesystem" MCP server (@modelcontextprotocol/server-filesystem),
built from the public tool spec in
`harness/fixtures/filesystem-tools-original.json` only. Local build
only — nothing pushed or published.

Identity: repo `fileport`, npm `@reneturcios/fileport`,
MCP name `io.github.CloudCorpRecords/fileport`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `fileport: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Sandboxed file access: read, write,
  edit and search in allowed dirs." = **68 chars** (≤100 ✓); npm entry
  carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/fileport:0.1.0` carries **no** `version`
  field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/fileport"`
- `tsconfig.json` (byte-identical to clockport/shipcheck, 318 bytes),
  `.gitignore`, `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios),
  `README.md` (fresh text), `CHANGELOG.md` (single 0.1.0 entry,
  2026-10-26)
- `src/index.ts`, `src/cli.ts` (`mcp [dirs...]`, `list <path>`,
  `read <path>`, `--version`; exit 2 usage / 1 operation error),
  `src/mcp.ts`, `src/types.ts`, `src/files.ts` (core logic,
  `VERSION = "0.1.0"`)
- `test/files.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (adapted from clockport/shipcheck; image
  `ghcr.io/cloudcorprecords/fileport` and smoke-test server name changed)

## Implementation notes

- **Security core:** allowed directories come from CLI args after
  `mcp`, else the `FILEPORT_ROOTS` env var (path-delimiter separated),
  else `process.cwd()`. Roots are canonicalised once at startup. Every
  tool path is resolved with `realpath` where it exists, and through
  its parent's realpath for new files, then checked for containment in
  a root — `..` escapes and symlink escapes are rejected with an
  "outside the allowed directories" error.
- **Registration:** `src/mcp.ts` uses the SDK low-level `Server` API
  with explicit `inputSchema` literals exactly as spec'd (no
  per-property descriptions, no extra keys), per the standing Wave 1
  rule; zod schemas validate every `tools/call` internally.
- All 14 tools implemented: `read_file`, `read_text_file` (head/tail
  mutually exclusive — error if both), `read_media_file` (base64
  image/audio/blob chosen by extension; MCP returns image/audio/blob
  content blocks accordingly), `read_multiple_files` (per-file failure
  reported in-band, others still returned), `write_file`, `edit_file`
  (exact-match replacements; `dryRun` returns a diff-like preview and
  writes nothing; missing `oldText` errors), `create_directory`,
  `list_directory` (`[FILE]` / `[DIR]` lines), `list_directory_with_sizes`
  (recursive directory sizes, `sortBy` name/size), `directory_tree`
  (JSON `{name, type, children?}` with exclude patterns), `move_file`,
  `search_files` (recursive glob), `get_file_info` (size,
  created/modified/accessed ISO times, type, rwx permissions), and
  `list_allowed_directories`.
- Glob matching is a small local glob→regex converter supporting
  `**`, `*`, and `?`; exclude patterns match names or basenames.
- Core uses Node stdlib only (plus SDK + zod). No network access.

## Verification (exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced (cli.js with `#!/usr/bin/env node` shebang, files.js,
mcp.js, index.js, types.js, plus .d.ts/.js.map).

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 15
ℹ pass 15
ℹ fail 0
```
Covers: allowed-dir enforcement (outside path and `..` escape
rejected), write+read roundtrip with parent creation, head/tail plus
the both-given error, edit apply + dryRun (no write) + missing
oldText error, create/list directory, list_with_sizes sorting by
name and by size, directory_tree shape + exclude patterns, move,
recursive glob search + excludes, get_file_info shape, media file
returns base64 image/blob, read_multiple partial failure, and the
glob matcher itself.

### 3. CLI smoke
`--version` -> `0.1.0`; `list .` printed `[DIR]` / `[FILE]` lines;
unknown command printed Usage and exited 2 (verified).

### 4. Parity (harness)
Original is tools-file mode, so the harness records
`fixture_results: SKIPPED-TOOLS-FILE-MODE` — expected semantics, not
an error:
```
$ python3 ~/workspace/mcp-rebuild-100/harness/parity.py \
    --original ~/workspace/mcp-rebuild-100/harness/fixtures/filesystem-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/fileport/dist/cli.js mcp" \
    --out ~/workspace/mcp-rebuild-100/builds/fileport/parity-out
verdict=PASS parity_pct=100.0 original_tools=14 rebuild_tools=14 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
`parity-out/parity.json` on disk confirms `parity_pct: 100.0`,
`identical_tools: 14`, `missing_tools: []`, `extra_tools: []`.

## Lockfile status

`package-lock.json` was copied from shipcheck with identity fields
edited (top-level name, root package name, bin key shipcheck ->
fileport); dependencies are identical ranges, so the tree is
unchanged. **Copied from shipcheck with identity fields edited;
clean lockfile regen required before publish** (fleet lesson
2026-10-25: generate with no `node_modules` present).
`node_modules` in this build dir is a `cp -a` copy of shipcheck's
(local build only, gitignored).

## Blockers / honest gaps

- None for the local build. Notes for the publish wave:
  - Regenerate `package-lock.json` clean before first publish.
  - Container build not exercised locally (no Docker run in this
    wave); the publish-container workflow smoke-tests the image at
    publish time.
  - Live original parity was not run (the original cannot launch in
    this VM — documented in SCOREBOARD.md); parity is against the
    audited tools-file ground truth.
  - mcpaudit / mcpvet / shipcheck pre-publish gate not run yet —
    belongs to the publish wave, as with the Wave 1 builds.

## Publish-gate remediation (2026-10-27)

Recorded under Rene's 2026-10-27 decision ("Remediate the 6: add param
descriptions + capability-class vet policy, then re-gate") and
`publish/GATE-POLICY.md`. This is an authorized deviation from the
parity-faithful state: descriptions were added to every tool parameter
that lacked one, in the `src/mcp.ts` schema literals only — parameter
names, types, required lists and enums are unchanged.

- Descriptions added: 25 (all 25 served parameters now described).
- Rebuild: `npm run build` (tsc) exit 0; `tsc --noEmit` exit 0; full
  test suite 15/15 pass.
- Parity harness re-run, verbatim: **PARTIAL, parity_pct 53.6** — all
  25 schema diffs are description additions (0 structural). Structural
  parity proven independently: stripping `description` keys from the
  post-remediation tools/list deep-equals the pre-remediation
  tools/list. Adjudication: the description-only diffs are the
  authorized remediation itself; structural parity is unchanged.
  Full record: `publish/parity-remediation/fileport/parity.json`.
- Re-gate: mcpaudit **PASS 100/100 grade A** (raw:
  `publish/regate/fileport-mcpaudit.json`); mcpvet raw **REVIEW,
  risk 50** (raw: `publish/regate/fileport-mcpvet.json`), findings
  adjudicated under GATE-POLICY.md — see PUBLISH-WAVES.md.
