import { realpath, open, writeFile, opendir } from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolResult } from "../../core/types.js";

const pathSchema = { type: "object", properties: { path: { type: "string", minLength: 1 } }, required: ["path"], additionalProperties: false };
export function createFilesystemTools(workspaceRoot: string, limits: { maxReadBytes?: number; maxDirectoryEntries?: number } = {}): Tool[] {
  const maxReadBytes = limits.maxReadBytes ?? 64 * 1024;
  const maxDirectoryEntries = limits.maxDirectoryEntries ?? 1_000;
  if (!Number.isSafeInteger(maxReadBytes) || maxReadBytes < 1 || maxReadBytes > 1_048_576) throw new Error("maxReadBytes must be an integer from 1 to 1048576");
  if (!Number.isSafeInteger(maxDirectoryEntries) || maxDirectoryEntries < 1 || maxDirectoryEntries > 10_000) throw new Error("maxDirectoryEntries must be an integer from 1 to 10000");
  const rootPromise = realpath(path.resolve(workspaceRoot));
  const resolveSafe = async (input: unknown, allowMissing = false): Promise<string> => {
    if (!input || typeof input !== "object" || typeof (input as { path?: unknown }).path !== "string") throw new Error("Invalid path");
    const raw = (input as { path: string }).path;
    const root = await rootPromise;
    const target = path.resolve(root, raw);
    if (!inside(root, target)) throw new Error("Path is outside workspace");
    let resolved: string;
    try { resolved = await realpath(target); }
    catch (e) {
      if (!allowMissing) throw e;
      const parent = await realpath(path.dirname(target));
      if (!inside(root, parent)) throw new Error("Path parent is outside workspace");
      resolved = path.join(parent, path.basename(target));
    }
    if (!inside(root, resolved)) throw new Error("Symlink escapes workspace");
    return resolved;
  };
  const wrap = async (args: unknown, fn: (args: unknown) => Promise<unknown>): Promise<ToolResult> => {
    try { return { ok: true, content: await fn(args) }; } catch (error) {
      return { ok: false, error: { code: "FILESYSTEM_ERROR", message: error instanceof Error ? error.message : "Filesystem operation failed" } };
    }
  };
  const read: Tool = { name: "fs_read", description: "Read a bounded UTF-8 preview of a file inside the configured workspace", inputSchema: pathSchema, risk: "read", execute: async args => wrap(args, async a => {
    const handle = await open(await resolveSafe(a), "r");
    try {
      const buffer = Buffer.alloc(maxReadBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const truncated = bytesRead > maxReadBytes;
      return `${buffer.subarray(0, Math.min(bytesRead, maxReadBytes)).toString("utf8")}${truncated ? "\n… [file preview truncated]" : ""}`;
    } finally { await handle.close(); }
  }) };
  const list: Tool = { name: "fs_list", description: "List entries in a directory inside the configured workspace", inputSchema: pathSchema, risk: "read", execute: async args => wrap(args, async a => {
    const directory = await opendir(await resolveSafe(a));
    const entries: { name: string; type: string }[] = [];
    let truncated = false;
    for await (const item of directory) {
      if (entries.length >= maxDirectoryEntries) { truncated = true; break; }
      entries.push({ name: item.name, type: item.isDirectory() ? "directory" : item.isFile() ? "file" : "other" });
    }
    return { entries, truncated };
  }) };
  const write: Tool = { name: "fs_write", description: "Write UTF-8 content to a file inside the configured workspace", inputSchema: { type: "object", properties: { path: { type: "string", minLength: 1 }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false }, risk: "write", execute: async args => {
    try {
      const a = args as { path: string; content: string };
      const target = await resolveSafe({ path: a.path }, true);
      await writeFile(target, a.content, { encoding: "utf8", flag: "w" });
      return { ok: true, content: { path: a.path, bytesWritten: Buffer.byteLength(a.content) } };
    } catch (error) { return { ok: false, error: { code: "FILESYSTEM_ERROR", message: error instanceof Error ? error.message : "Filesystem operation failed" } }; }
  } };
  return [read, list, write];
}
function inside(root: string, target: string): boolean { const rel = path.relative(root, target); return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel)); }
