/**
 * fileport MCP server. 14 filesystem tools, sandboxed to allowed dirs.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects two keys that are not
 * in this tool's public spec ("$schema" and "additionalProperties"),
 * which breaks exact tool-list/schema parity with the spec. This file
 * therefore serves tools/list with the spec's exact input schemas,
 * while zod still validates every tools/call argument set.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createDirectory,
  directoryTree,
  editFile,
  getFileInfo,
  listAllowedDirectories,
  listDirectory,
  listDirectoryWithSizes,
  moveFile,
  readFileContent,
  readMediaFile,
  readMultipleFiles,
  readTextFile,
  searchFiles,
  VERSION,
  writeFileContent,
} from "./files.js";

const PathArgs = z.object({ path: z.string() });
const ReadTextArgs = z.object({
  path: z.string(),
  head: z.number().optional(),
  tail: z.number().optional(),
});
const ReadMultipleArgs = z.object({ paths: z.array(z.string()) });
const WriteArgs = z.object({ path: z.string(), content: z.string() });
const EditArgs = z.object({
  path: z.string(),
  edits: z.array(z.object({ oldText: z.string(), newText: z.string() })),
  dryRun: z.boolean().optional(),
});
const ListSizesArgs = z.object({
  path: z.string(),
  sortBy: z.enum(["name", "size"]).optional(),
});
const TreeArgs = z.object({
  path: z.string(),
  excludePatterns: z.array(z.string()).optional(),
});
const MoveArgs = z.object({ source: z.string(), destination: z.string() });
const SearchArgs = z.object({
  path: z.string(),
  pattern: z.string(),
  excludePatterns: z.array(z.string()).optional(),
});
const EmptyArgs = z.object({});

const TOOLS = [
  {
    name: "read_file",
    description: "Read the full contents of a file as text.",
    inputSchema: {
      type: "object" as const,
      properties: { path: { description: "Path of the file to read, inside one of the allowed directories.", type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "read_text_file",
    description: "Read a text file, optionally limited to its first or last lines.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { description: "Path of the text file to read, inside one of the allowed directories.", type: "string" },
        head: { description: "Return only the first N lines of the file; mutually exclusive with tail.", type: "number" },
        tail: { description: "Return only the last N lines of the file; mutually exclusive with head.", type: "number" },
      },
      required: ["path"],
    },
  },
  {
    name: "read_media_file",
    description: "Read a media file and return it as base64 content.",
    inputSchema: {
      type: "object" as const,
      properties: { path: { description: "Path of the media file to read, inside one of the allowed directories.", type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "read_multiple_files",
    description: "Read several files at once, reporting per-file failures in-band.",
    inputSchema: {
      type: "object" as const,
      properties: { paths: { description: "Paths of the files to read, each inside one of the allowed directories.", type: "array", items: { type: "string" } } },
      required: ["paths"],
    },
  },
  {
    name: "write_file",
    description: "Write text content to a file, creating parent folders as needed.",
    inputSchema: {
      type: "object" as const,
      properties: { path: { description: "Path of the file to write, inside one of the allowed directories.", type: "string" }, content: { description: "Text content to write to the file.", type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Apply exact-match text replacements to a file, with an optional dry run.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { description: "Path of the file to edit, inside one of the allowed directories.", type: "string" },
        edits: { description: "Exact-match text replacements to apply to the file, in order.", type: "array",
          items: {
            type: "object",
            properties: {
              oldText: { description: "Exact text to find in the file.", type: "string" },
              newText: { description: "Text to replace the matched oldText with.", type: "string" },
            },
            required: ["oldText", "newText"],
          },
        },
        dryRun: { description: "When true, report the changes that would be made without writing the file.", type: "boolean" },
      },
      required: ["path", "edits"],
    },
  },
  {
    name: "create_directory",
    description: "Create a directory, including any missing parents.",
    inputSchema: {
      type: "object" as const,
      properties: { path: { description: "Path of the directory to create, inside one of the allowed directories.", type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description: "List the entries of a directory.",
    inputSchema: {
      type: "object" as const,
      properties: { path: { description: "Path of the directory to list, inside one of the allowed directories.", type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "list_directory_with_sizes",
    description: "List directory entries together with their sizes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { description: "Path of the directory to list, inside one of the allowed directories.", type: "string" },
        sortBy: { description: "Sort the entries by name or by size.", type: "string", enum: ["name", "size"] },
      },
      required: ["path"],
    },
  },
  {
    name: "directory_tree",
    description: "Return a directory as a nested JSON tree.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { description: "Path of the directory to return as a tree, inside one of the allowed directories.", type: "string" },
        excludePatterns: { description: "Glob patterns for paths to exclude from the tree.", type: "array", items: { type: "string" } },
      },
      required: ["path"],
    },
  },
  {
    name: "move_file",
    description: "Move or rename a file or directory.",
    inputSchema: {
      type: "object" as const,
      properties: { source: { description: "Current path of the file or directory to move, inside one of the allowed directories.", type: "string" }, destination: { description: "New path for the file or directory, inside one of the allowed directories.", type: "string" } },
      required: ["source", "destination"],
    },
  },
  {
    name: "search_files",
    description: "Recursively search for files whose names match a glob pattern.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { description: "Directory to search recursively, inside one of the allowed directories.", type: "string" },
        pattern: { description: "Glob pattern matched against file names.", type: "string" },
        excludePatterns: { description: "Glob patterns for paths to exclude from the search.", type: "array", items: { type: "string" } },
      },
      required: ["path", "pattern"],
    },
  },
  {
    name: "get_file_info",
    description: "Return metadata about a file or directory.",
    inputSchema: {
      type: "object" as const,
      properties: { path: { description: "Path of the file or directory to inspect, inside one of the allowed directories.", type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "list_allowed_directories",
    description: "List the directories this server is allowed to access.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
];

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "fileport", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case "read_file": {
        const a = PathArgs.parse(args ?? {});
        return textResult(await readFileContent(a.path));
      }
      case "read_text_file": {
        const a = ReadTextArgs.parse(args ?? {});
        return textResult(await readTextFile(a.path, a.head, a.tail));
      }
      case "read_media_file": {
        const a = PathArgs.parse(args ?? {});
        const media = await readMediaFile(a.path);
        if (media.kind === "image") {
          return {
            content: [
              { type: "image" as const, data: media.data, mimeType: media.mimeType },
            ],
          };
        }
        if (media.kind === "audio") {
          return {
            content: [
              { type: "audio" as const, data: media.data, mimeType: media.mimeType },
            ],
          };
        }
        return {
          content: [
            {
              type: "resource" as const,
              resource: { uri: `file://${a.path}`, mimeType: media.mimeType, blob: media.data },
            },
          ],
        };
      }
      case "read_multiple_files": {
        const a = ReadMultipleArgs.parse(args ?? {});
        const results = await readMultipleFiles(a.paths);
        const text = results
          .map((r) =>
            r.error ? `${r.path}: Error - ${r.error}` : `${r.path}:\n${r.content}\n---`,
          )
          .join("\n");
        return textResult(text);
      }
      case "write_file": {
        const a = WriteArgs.parse(args ?? {});
        await writeFileContent(a.path, a.content);
        return textResult(`Wrote ${a.path}`);
      }
      case "edit_file": {
        const a = EditArgs.parse(args ?? {});
        return textResult(await editFile(a.path, a.edits, a.dryRun));
      }
      case "create_directory": {
        const a = PathArgs.parse(args ?? {});
        await createDirectory(a.path);
        return textResult(`Created directory ${a.path}`);
      }
      case "list_directory": {
        const a = PathArgs.parse(args ?? {});
        return textResult(await listDirectory(a.path));
      }
      case "list_directory_with_sizes": {
        const a = ListSizesArgs.parse(args ?? {});
        return textResult(await listDirectoryWithSizes(a.path, a.sortBy));
      }
      case "directory_tree": {
        const a = TreeArgs.parse(args ?? {});
        return jsonResult(await directoryTree(a.path, a.excludePatterns));
      }
      case "move_file": {
        const a = MoveArgs.parse(args ?? {});
        await moveFile(a.source, a.destination);
        return textResult(`Moved ${a.source} to ${a.destination}`);
      }
      case "search_files": {
        const a = SearchArgs.parse(args ?? {});
        const found = await searchFiles(a.path, a.pattern, a.excludePatterns);
        return textResult(found.join("\n"));
      }
      case "get_file_info": {
        const a = PathArgs.parse(args ?? {});
        return jsonResult(await getFileInfo(a.path));
      }
      case "list_allowed_directories": {
        EmptyArgs.parse(args ?? {});
        return textResult(listAllowedDirectories().join("\n"));
      }
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
