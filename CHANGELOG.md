# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `fileport list <path>` lists a directory and `fileport read <path>`
  prints a file; `fileport mcp [dirs...]` starts the stdio MCP server.
- MCP server with 14 tools: `read_file`, `read_text_file`,
  `read_media_file`, `read_multiple_files`, `write_file`, `edit_file`,
  `create_directory`, `list_directory`, `list_directory_with_sizes`,
  `directory_tree`, `move_file`, `search_files`, `get_file_info`, and
  `list_allowed_directories`.
- Every path is confined to the allowed directories (CLI args after
  `mcp`, `FILEPORT_ROOTS`, or the working directory by default).
