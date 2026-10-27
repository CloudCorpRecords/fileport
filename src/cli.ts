#!/usr/bin/env node
/**
 * fileport CLI.
 *
 *   fileport mcp [dirs...]
 *   fileport list <path>
 *   fileport read <path>
 *   fileport --version
 *
 * Exit codes: 0 success, 1 operation error, 2 usage error.
 * Allowed directories for `mcp` come from the dirs after `mcp`, the
 * FILEPORT_ROOTS env var, or the working directory by default. The
 * `list` / `read` helpers use the same resolution against the cwd.
 */
import fs from "node:fs";
import {
  getAllowedDirs,
  initAllowedDirs,
  listDirectory,
  readFileContent,
  VERSION,
} from "./files.js";

function usage(): never {
  console.error(`Usage:
  fileport mcp [dirs...]
  fileport list <path>
  fileport read <path>
  fileport --version`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    // Allowed dirs are consumed by the MCP module from argv/env.
    const { setAllowedDirs, resolveAllowedDirs } = await import("./files.js");
    setAllowedDirs(resolveAllowedDirs(rest));
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  try {
    if (cmd === "list") {
      const [p] = rest;
      if (!p) usage();
      initAllowedDirs([process.cwd()]);
      // Allow listing the cwd tree; paths outside cwd are rejected by core.
      void getAllowedDirs();
      void fs;
      console.log(await listDirectory(p));
    } else if (cmd === "read") {
      const [p] = rest;
      if (!p) usage();
      initAllowedDirs([process.cwd()]);
      console.log(await readFileContent(p));
    } else {
      usage();
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
