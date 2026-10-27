import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createDirectory,
  directoryTree,
  editFile,
  getFileInfo,
  globMatch,
  initAllowedDirs,
  listAllowedDirectories,
  listDirectory,
  listDirectoryWithSizes,
  moveFile,
  readFileContent,
  readMediaFile,
  readMultipleFiles,
  readTextFile,
  searchFiles,
  writeFileContent,
} from "../src/files.js";

let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "fileport-test-"));
  initAllowedDirs([root]);
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe("allowed-dir enforcement", () => {
  it("rejects paths outside the allowed root", async () => {
    const outside = path.join(os.tmpdir(), "definitely-outside-fileport.txt");
    await assert.rejects(() => readFileContent(outside), /outside the allowed/);
    await assert.rejects(() => writeFileContent(outside, "x"), /outside the allowed/);
  });

  it("rejects .. escapes", async () => {
    const escape = path.join(root, "..", "escape.txt");
    await assert.rejects(() => readFileContent(escape), /outside the allowed/);
  });

  it("lists the allowed directories", () => {
    const dirs = listAllowedDirectories();
    assert.equal(dirs.length, 1);
    assert.equal(fs.realpathSync(dirs[0]), fs.realpathSync(root));
  });
});

describe("write + read roundtrip", () => {
  it("writes and reads back text, creating parents", async () => {
    const p = path.join(root, "sub", "hello.txt");
    await writeFileContent(p, "hello fileport");
    assert.equal(await readFileContent(p), "hello fileport");
    assert.equal(await readTextFile(p), "hello fileport");
  });
});

describe("read_text_file head/tail", () => {
  it("supports head and tail, and rejects both together", async () => {
    const p = path.join(root, "lines.txt");
    await writeFileContent(p, "a\nb\nc\nd");
    assert.equal(await readTextFile(p, 2), "a\nb");
    assert.equal(await readTextFile(p, undefined, 2), "c\nd");
    await assert.rejects(() => readTextFile(p, 1, 1), /mutually exclusive/);
  });
});

describe("edit_file", () => {
  it("applies edits, previews on dryRun, errors on missing oldText", async () => {
    const p = path.join(root, "edit.txt");
    await writeFileContent(p, "the quick fox");
    const preview = await editFile(p, [{ oldText: "quick", newText: "slow" }], true);
    assert.match(preview, /dry run/);
    assert.match(preview, /slow/);
    // dryRun must not write
    assert.equal(await readFileContent(p), "the quick fox");
    const msg = await editFile(p, [{ oldText: "quick", newText: "slow" }]);
    assert.match(msg, /Applied 1 edit/);
    assert.equal(await readFileContent(p), "the slow fox");
    await assert.rejects(
      () => editFile(p, [{ oldText: "missing", newText: "x" }]),
      /not found/,
    );
  });
});

describe("directories", () => {
  it("creates and lists directories", async () => {
    const d = path.join(root, "docs");
    await createDirectory(d);
    await writeFileContent(path.join(d, "a.txt"), "a");
    const listing = await listDirectory(root);
    assert.match(listing, /\[DIR\] docs/);
    const inner = await listDirectory(d);
    assert.equal(inner, "[FILE] a.txt");
  });

  it("lists with sizes and sorts by size", async () => {
    await writeFileContent(path.join(root, "small.txt"), "x");
    await writeFileContent(path.join(root, "big.txt"), "x".repeat(100));
    const byName = await listDirectoryWithSizes(root, "name");
    assert.ok(byName.indexOf("big.txt") < byName.indexOf("small.txt"));
    const bySize = await listDirectoryWithSizes(root, "size");
    assert.ok(bySize.indexOf("small.txt") < bySize.indexOf("big.txt"));
    assert.match(bySize, /\(100 bytes\)/);
  });

  it("builds a tree and honours excludes", async () => {
    await createDirectory(path.join(root, "src"));
    await writeFileContent(path.join(root, "src", "main.ts"), "code");
    await writeFileContent(path.join(root, "skip.log"), "log");
    const tree = await directoryTree(root);
    assert.equal(tree.type, "directory");
    assert.ok(tree.children?.some((c) => c.name === "src" && c.type === "directory"));
    const src = tree.children?.find((c) => c.name === "src");
    assert.ok(src?.children?.some((c) => c.name === "main.ts" && c.type === "file"));
    const pruned = await directoryTree(root, ["*.log"]);
    assert.ok(!pruned.children?.some((c) => c.name === "skip.log"));
  });
});

describe("move, search, info", () => {
  it("moves a file", async () => {
    const src = path.join(root, "before.txt");
    const dst = path.join(root, "after.txt");
    await writeFileContent(src, "payload");
    await moveFile(src, dst);
    assert.equal(await readFileContent(dst), "payload");
    assert.equal(fs.existsSync(src), false);
  });

  it("searches by glob recursively", async () => {
    await createDirectory(path.join(root, "deep"));
    await writeFileContent(path.join(root, "top.md"), "# t");
    await writeFileContent(path.join(root, "deep", "note.md"), "# n");
    await writeFileContent(path.join(root, "deep", "note.txt"), "n");
    const found = await searchFiles(root, "*.md");
    assert.equal(found.length, 2);
    assert.ok(found.every((f) => f.endsWith(".md")));
    const excluded = await searchFiles(root, "*.md", ["deep"]);
    assert.equal(excluded.length, 1);
  });

  it("returns file info", async () => {
    const p = path.join(root, "info.txt");
    await writeFileContent(p, "12345");
    const info = await getFileInfo(p);
    assert.equal(info.size, 5);
    assert.equal(info.type, "file");
    assert.equal(info.isFile, true);
    assert.ok(info.created.length > 0 && info.modified.length > 0);
    assert.match(info.permissions, /^[r-][w-][x-][r-][w-][x-][r-][w-][x-]$/);
  });
});

describe("media and multiple reads", () => {
  it("returns base64 blob content for a media file", async () => {
    const p = path.join(root, "pic.png");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    await fsp.writeFile(p, bytes);
    const media = await readMediaFile(p);
    assert.equal(media.kind, "image");
    assert.equal(media.mimeType, "image/png");
    assert.equal(Buffer.from(media.data, "base64").equals(bytes), true);
    const bin = path.join(root, "data.bin");
    await fsp.writeFile(bin, bytes);
    const blob = await readMediaFile(bin);
    assert.equal(blob.kind, "blob");
  });

  it("reports partial failures in-band for read_multiple_files", async () => {
    const good = path.join(root, "good.txt");
    await writeFileContent(good, "ok");
    const missing = path.join(root, "missing.txt");
    const results = await readMultipleFiles([good, missing]);
    assert.equal(results.length, 2);
    assert.equal(results[0].content, "ok");
    assert.ok(results[1].error && results[1].error.length > 0);
  });
});

describe("glob matcher", () => {
  it("supports *, ?, and **", () => {
    assert.equal(globMatch("a.txt", "*.txt"), true);
    assert.equal(globMatch("a.md", "*.txt"), false);
    assert.equal(globMatch("abc", "a?c"), true);
    assert.equal(globMatch("a/b/c.txt", "**/*.txt"), true);
    assert.equal(globMatch("file1.log", "file?.log"), true);
  });
});
