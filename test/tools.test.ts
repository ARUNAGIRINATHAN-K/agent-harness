import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFilesystemTools } from "../src/tools/fs/index.js";
import { createCommandPresetTools } from "../src/tools/commands/index.js";

test("filesystem tools confine reads and writes to workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-harness-"));
  try {
    await writeFile(path.join(root, "inside.txt"), "inside");
    const [read, , write] = createFilesystemTools(root);
    assert.deepEqual(await read!.execute({ path: "inside.txt" }, { signal: new AbortController().signal }), { ok: true, content: "inside" });
    assert.equal((await read!.execute({ path: "../outside.txt" }, { signal: new AbortController().signal })).ok, false);
    assert.equal((await write!.execute({ path: "new.txt", content: "safe" }, { signal: new AbortController().signal })).ok, true);
    assert.equal(await readFile(path.join(root, "new.txt"), "utf8"), "safe");
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.txt`);
    await writeFile(outside, "outside");
    let symlinkCreated = false;
    try { await symlink(outside, path.join(root, "escape.txt")); symlinkCreated = true; } catch { /* symlink creation may be unavailable on the host */ }
    if (symlinkCreated) assert.equal((await read!.execute({ path: "escape.txt" }, { signal: new AbortController().signal })).ok, false);
    await rm(outside, { force: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("command presets use fixed argv and no shell", async () => {
  const tool = createCommandPresetTools([{ id: "version", description: "node version", executable: process.execPath, args: ["--version"] }])[0]!;
  const result = await tool.execute({}, { signal: new AbortController().signal });
  assert.equal(result.ok, true);
  assert.equal(tool.risk, "command");
  assert.throws(() => createCommandPresetTools([{ id: "bad id", description: "bad", executable: "x", args: [] }]), /Invalid/);
});
test("filesystem read previews are bounded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-harness-"));
  try {
    await writeFile(path.join(root, "large.txt"), "abcdefghij");
    const [read] = createFilesystemTools(root, { maxReadBytes: 4 });
    const result = await read!.execute({ path: "large.txt" }, { signal: new AbortController().signal });
    assert.deepEqual(result, { ok: true, content: "abcd\n… [file preview truncated]" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
