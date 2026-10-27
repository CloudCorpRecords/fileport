/**
 * fileport core: sandboxed filesystem operations.
 *
 * Allowed directories are the security boundary. Every path a caller
 * supplies is resolved against the real filesystem (following symlinks
 * where the target exists, and via its parent where it does not yet)
 * and must land inside one of the allowed roots, or the call fails.
 * No network is used; everything goes through Node's fs module.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { EditSpec, FileInfo, MediaResult, SizedEntry, TreeNode } from "./types.js";

export const VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Allowed directories
// ---------------------------------------------------------------------------

export function resolveAllowedDirs(args: string[]): string[] {
  let raw: string[] = [];
  if (args.length > 0) raw = args;
  else if (process.env.FILEPORT_ROOTS) {
    raw = process.env.FILEPORT_ROOTS.split(path.delimiter).filter(Boolean);
  } else {
    raw = [process.cwd()];
  }
  return raw.map((d) => {
    const abs = path.resolve(d);
    try {
      return fs.realpathSync(abs);
    } catch {
      return abs;
    }
  });
}

let allowedDirs: string[] | null = null;

export function setAllowedDirs(dirs: string[]): void {
  allowedDirs = dirs.map((d) => {
    const abs = path.resolve(d);
    try {
      return fs.realpathSync(abs);
    } catch {
      return abs;
    }
  });
}

export function getAllowedDirs(): string[] {
  if (!allowedDirs) allowedDirs = resolveAllowedDirs([]);
  return allowedDirs;
}

/** Test helper: reset to a single root. */
export function initAllowedDirs(dirs: string[]): void {
  setAllowedDirs(dirs);
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a caller path to an absolute real path and enforce the sandbox.
 * Existing targets are canonicalised with realpath; new targets are
 * canonicalised through their parent directory.
 */
export async function resolveAllowed(p: string): Promise<string> {
  if (typeof p !== "string" || p.length === 0) {
    throw new Error("path must be a non-empty string");
  }
  const abs = path.resolve(p);
  let real: string;
  try {
    real = await fsp.realpath(abs);
  } catch {
    // Target may not exist yet (write / create / move destination).
    const parent = path.dirname(abs);
    let realParent: string;
    try {
      realParent = await fsp.realpath(parent);
    } catch {
      realParent = parent;
    }
    real = path.join(realParent, path.basename(abs));
  }
  const roots = getAllowedDirs();
  for (const root of roots) {
    if (isInside(real, root)) return real;
  }
  throw new Error(
    `Access denied: path '${p}' is outside the allowed directories (${roots.join(", ")})`,
  );
}

/** Sync variant used by CLI list/read helpers. */
export function resolveAllowedSync(p: string): string {
  const abs = path.resolve(p);
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    const parent = path.dirname(abs);
    let realParent: string;
    try {
      realParent = fs.realpathSync(parent);
    } catch {
      realParent = parent;
    }
    real = path.join(realParent, path.basename(abs));
  }
  const roots = getAllowedDirs();
  for (const root of roots) {
    if (isInside(real, root)) return real;
  }
  throw new Error(
    `Access denied: path '${p}' is outside the allowed directories (${roots.join(", ")})`,
  );
}

// ---------------------------------------------------------------------------
// Glob matching: supports **, *, ?
// ---------------------------------------------------------------------------

export function globToRegExp(pattern: string): RegExp {
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // ** matches any characters including path separators
        re += ".*";
        i += 2;
        if (pattern[i] === "/") i += 1;
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  re += "$";
  return new RegExp(re);
}

export function globMatch(name: string, pattern: string): boolean {
  return globToRegExp(pattern).test(name);
}

function matchesAny(name: string, patterns: string[]): boolean {
  return patterns.some((pat) => {
    if (globMatch(name, pat)) return true;
    // Also match against the basename for convenience with plain patterns.
    return globMatch(path.basename(name), pat);
  });
}

// ---------------------------------------------------------------------------
// Media types by extension
// ---------------------------------------------------------------------------

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

const AUDIO_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
};

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function readFileContent(p: string): Promise<string> {
  const real = await resolveAllowed(p);
  return fsp.readFile(real, "utf-8");
}

export async function readTextFile(
  p: string,
  head?: number,
  tail?: number,
): Promise<string> {
  if (head !== undefined && tail !== undefined) {
    throw new Error("head and tail are mutually exclusive; provide only one");
  }
  const content = await readFileContent(p);
  if (head === undefined && tail === undefined) return content;
  const lines = content.split("\n");
  // A trailing newline produces a final empty element; keep line semantics
  // simple by working on the raw split.
  if (head !== undefined) return lines.slice(0, head).join("\n");
  return lines.slice(Math.max(0, lines.length - (tail as number))).join("\n");
}

export async function readMediaFile(p: string): Promise<MediaResult> {
  const real = await resolveAllowed(p);
  const buf = await fsp.readFile(real);
  const ext = path.extname(real).toLowerCase();
  if (IMAGE_TYPES[ext]) {
    return { kind: "image", mimeType: IMAGE_TYPES[ext], data: buf.toString("base64") };
  }
  if (AUDIO_TYPES[ext]) {
    return { kind: "audio", mimeType: AUDIO_TYPES[ext], data: buf.toString("base64") };
  }
  return { kind: "blob", mimeType: "application/octet-stream", data: buf.toString("base64") };
}

export async function readMultipleFiles(
  paths: string[],
): Promise<Array<{ path: string; content?: string; error?: string }>> {
  const out: Array<{ path: string; content?: string; error?: string }> = [];
  for (const p of paths) {
    try {
      const content = await readFileContent(p);
      out.push({ path: p, content });
    } catch (err) {
      out.push({ path: p, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

export async function writeFileContent(p: string, content: string): Promise<void> {
  const real = await resolveAllowed(p);
  await fsp.mkdir(path.dirname(real), { recursive: true });
  await fsp.writeFile(real, content, "utf-8");
}

export async function editFile(
  p: string,
  edits: EditSpec[],
  dryRun?: boolean,
): Promise<string> {
  const real = await resolveAllowed(p);
  const original = await fsp.readFile(real, "utf-8");
  let updated = original;
  for (const e of edits) {
    if (!updated.includes(e.oldText)) {
      throw new Error(`edit failed: oldText not found in ${p}: ${JSON.stringify(e.oldText.slice(0, 80))}`);
    }
    updated = updated.replace(e.oldText, e.newText);
  }
  if (dryRun) {
    const lines: string[] = [`--- ${p} (dry run, no changes written)`, `+++ ${p}`];
    for (const e of edits) {
      lines.push(`- ${e.oldText}`);
      lines.push(`+ ${e.newText}`);
    }
    lines.push("", "Resulting content preview:");
    lines.push(updated);
    return lines.join("\n");
  }
  await fsp.writeFile(real, updated, "utf-8");
  return `Applied ${edits.length} edit(s) to ${p}`;
}

export async function createDirectory(p: string): Promise<void> {
  const real = await resolveAllowed(p);
  await fsp.mkdir(real, { recursive: true });
}

export async function listDirectory(p: string): Promise<string> {
  const real = await resolveAllowed(p);
  const entries = await fsp.readdir(real, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries
    .map((e) => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`)
    .join("\n");
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(full);
    else {
      try {
        total += (await fsp.stat(full)).size;
      } catch {
        // skip unreadable entries
      }
    }
  }
  return total;
}

export async function listDirectoryWithSizes(
  p: string,
  sortBy?: string,
): Promise<string> {
  const real = await resolveAllowed(p);
  const entries = await fsp.readdir(real, { withFileTypes: true });
  const sized: SizedEntry[] = [];
  for (const e of entries) {
    const full = path.join(real, e.name);
    let size = 0;
    if (e.isDirectory()) size = await dirSize(full);
    else size = (await fsp.stat(full)).size;
    sized.push({ name: e.name, type: e.isDirectory() ? "directory" : "file", size });
  }
  if (sortBy === "size") sized.sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
  else sized.sort((a, b) => a.name.localeCompare(b.name));
  return sized
    .map((e) => `${e.type === "directory" ? "[DIR]" : "[FILE]"} ${e.name} (${e.size} bytes)`)
    .join("\n");
}

export async function directoryTree(
  p: string,
  excludePatterns?: string[],
): Promise<TreeNode> {
  const real = await resolveAllowed(p);
  const excludes = excludePatterns ?? [];
  async function build(dir: string): Promise<TreeNode> {
    const stat = await fsp.stat(dir);
    const node: TreeNode = {
      name: path.basename(dir) || dir,
      type: stat.isDirectory() ? "directory" : "file",
    };
    if (stat.isDirectory()) {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      node.children = [];
      for (const e of entries) {
        if (excludes.length && matchesAny(e.name, excludes)) continue;
        node.children.push(await build(path.join(dir, e.name)));
      }
    }
    return node;
  }
  return build(real);
}

export async function moveFile(source: string, destination: string): Promise<void> {
  const src = await resolveAllowed(source);
  const dst = await resolveAllowed(destination);
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.rename(src, dst);
}

export async function searchFiles(
  p: string,
  pattern: string,
  excludePatterns?: string[],
): Promise<string[]> {
  const real = await resolveAllowed(p);
  const excludes = excludePatterns ?? [];
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (excludes.length && matchesAny(e.name, excludes)) continue;
      if (e.isDirectory()) {
        await walk(full);
      } else if (globMatch(e.name, pattern) || globMatch(full, pattern)) {
        results.push(full);
      }
    }
  }
  await walk(real);
  return results;
}

export async function getFileInfo(p: string): Promise<FileInfo> {
  const real = await resolveAllowed(p);
  const stat = await fsp.stat(real);
  const mode = stat.mode;
  const perms =
    (mode & 0o400 ? "r" : "-") +
    (mode & 0o200 ? "w" : "-") +
    (mode & 0o100 ? "x" : "-") +
    (mode & 0o040 ? "r" : "-") +
    (mode & 0o020 ? "w" : "-") +
    (mode & 0o010 ? "x" : "-") +
    (mode & 0o004 ? "r" : "-") +
    (mode & 0o002 ? "w" : "-") +
    (mode & 0o001 ? "x" : "-");
  return {
    name: path.basename(real),
    path: real,
    size: stat.size,
    created: stat.birthtime.toISOString(),
    modified: stat.mtime.toISOString(),
    accessed: stat.atime.toISOString(),
    isDirectory: stat.isDirectory(),
    isFile: stat.isFile(),
    type: stat.isDirectory() ? "directory" : "file",
    permissions: perms,
  };
}

export function listAllowedDirectories(): string[] {
  return getAllowedDirs();
}
