import { spawn } from "node:child_process";
import type { Tool, ToolResult } from "../../core/types.js";

export interface CommandPreset { id: string; description: string; executable: string; args: readonly string[]; cwd?: string; timeoutMs?: number; maxOutputChars?: number }
export function createCommandPresetTools(presets: readonly CommandPreset[]): Tool[] {
  const seen = new Set<string>();
  return presets.map(preset => {
    if (!/^[a-z][a-z0-9_-]*$/i.test(preset.id) || seen.has(preset.id)) throw new Error(`Invalid or duplicate command preset: ${preset.id}`);
    if (!preset.executable || preset.executable.includes("\0") || preset.args.some(a => a.includes("\0"))) throw new Error(`Invalid command preset: ${preset.id}`);
    seen.add(preset.id);
    return {
      name: `command_${preset.id}`, description: `${preset.description} (fixed command: ${preset.executable} ${preset.args.map(a => JSON.stringify(a)).join(" ")})`, inputSchema: { type: "object", properties: {}, additionalProperties: false }, risk: "command" as const,
      execute: async (_input: unknown, context): Promise<ToolResult> => new Promise(resolve => {
        const child = spawn(preset.executable, [...preset.args], { cwd: preset.cwd ?? context.workspace, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        const cap = preset.maxOutputChars ?? 16_000;
        let stdout = "", stderr = "", settled = false;
        const finish = (result: ToolResult) => { if (!settled) { settled = true; clearTimeout(timer); context.signal.removeEventListener("abort", abort); resolve(result); } };
        const collect = (current: string, chunk: Buffer): string => (current + chunk.toString("utf8")).slice(0, cap);
        child.stdout.on("data", (chunk: Buffer) => { stdout = collect(stdout, chunk); });
        child.stderr.on("data", (chunk: Buffer) => { stderr = collect(stderr, chunk); });
        child.on("error", () => finish({ ok: false, error: { code: "COMMAND_START_FAILED", message: "Preset could not be started" } }));
        child.on("close", (code, signal) => finish({ ok: code === 0, ...(code === 0 ? { content: { code, stdout, stderr } } : { error: { code: "COMMAND_FAILED", message: `Preset exited (${signal ?? code}): ${stderr}` } }) } as ToolResult));
        const abort = () => { child.kill(); finish({ ok: false, error: { code: "CANCELLED", message: "Command cancellation requested" } }); };
        context.signal.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(() => { child.kill(); finish({ ok: false, error: { code: "COMMAND_TIMEOUT", message: "Command preset timed out" } }); }, preset.timeoutMs ?? 30_000);
        if (context.signal.aborted) abort();
      })
    };
  });
}
