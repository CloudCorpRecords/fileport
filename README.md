# fileport

fileport gives an agent careful, sandboxed access to the local
filesystem. It can read and write text, return media as base64, apply
exact-match edits, walk directory trees, and search by glob — but only
inside the directories you allow. Anything outside those roots is
refused, including paths that escape through `..` segments or symlinks.

## Install

```bash
npx @reneturcios/fileport list .
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/fileport
```

The container defaults to the MCP server. Pass CLI arguments to use it
as a CLI instead.

## Allowed directories

The sandbox is the whole point of this tool, so it is configured
explicitly:

- `fileport mcp /data/docs /data/notes` — the arguments after `mcp` are
  the allowed roots.
- `FILEPORT_ROOTS` — a path-delimiter-separated list used when no
  arguments are given.
- With neither set, the current working directory is the only root.

Every path a tool receives is canonicalised (symlinks resolved; new
files resolved through their parent) and checked against the roots
before any read or write happens.

## CLI

```bash
fileport list <path>     # entries as [FILE] / [DIR] lines
fileport read <path>     # print a file's text contents
fileport mcp [dirs...]   # start the stdio MCP server
fileport --version
```

Exit codes: `0` on success, `1` when an operation fails (for example a
path outside the allowed directories), `2` for usage errors. The
`list` and `read` helpers resolve paths against the working directory.

## MCP server

```bash
npx -y @reneturcios/fileport mcp /path/to/allowed/dir
```

MCP client configuration:

```json
{
  "mcpServers": {
    "fileport": {
      "command": "npx",
      "args": ["-y", "@reneturcios/fileport", "mcp", "/path/to/allowed/dir"]
    }
  }
}
```

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `read_file` | `path` | The file's full text contents. |
| `read_text_file` | `path`, optional `head` or `tail` (line counts, mutually exclusive) | The file text, or just its first/last lines. |
| `read_media_file` | `path` | Base64 image, audio, or blob content chosen by extension. |
| `read_multiple_files` | `paths` | Each file's contents; a failure for one file is reported in-band and does not stop the others. |
| `write_file` | `path`, `content` | Writes the text, creating parent folders as needed. |
| `edit_file` | `path`, `edits` (`oldText`/`newText` pairs), optional `dryRun` | Applies each exact-match replacement, or returns a diff-like preview when `dryRun` is set. Errors if an `oldText` is not found. |
| `create_directory` | `path` | Creates the directory and any missing parents. |
| `list_directory` | `path` | Entries as `[FILE] name` / `[DIR] name` lines. |
| `list_directory_with_sizes` | `path`, optional `sortBy` (`name` or `size`) | Entries with sizes; directories report their recursive total. |
| `directory_tree` | `path`, optional `excludePatterns` | A nested JSON tree of `{name, type, children?}` nodes. |
| `move_file` | `source`, `destination` | Moves or renames within the sandbox. |
| `search_files` | `path`, `pattern`, optional `excludePatterns` | Recursive glob search over file names (`**`, `*`, `?`). |
| `get_file_info` | `path` | Size, created/modified/accessed times, type, and permissions. |
| `list_allowed_directories` | — | The roots currently in force. |

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
