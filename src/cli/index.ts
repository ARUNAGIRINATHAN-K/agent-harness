#!/usr/bin/env node
import { runAgent } from "../core/agent.js";
import { OpenAIModel } from "../providers/openai.js";
import { AnthropicModel } from "../providers/anthropic.js";
import { OllamaModel } from "../providers/ollama.js";
import { createFilesystemTools } from "../tools/fs/index.js";
import { createInterface } from "node:readline/promises";

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
async function main(): Promise<void> {
  const provider = arg("--provider") ?? "ollama";
  const modelName = arg("--model") ?? (provider === "ollama" ? "llama3.2" : undefined);
  const prompt = arg("--prompt") ?? (process.stdin.isTTY ? undefined : await readStdin());
  if (!prompt) throw new Error("Provide --prompt or pipe a prompt on stdin");
  if (!modelName) throw new Error("Provide --model");
  const model = provider === "openai" ? new OpenAIModel({ apiKey: process.env.OPENAI_API_KEY ?? "", model: modelName })
    : provider === "anthropic" ? new AnthropicModel({ apiKey: process.env.ANTHROPIC_API_KEY ?? "", model: modelName })
      : provider === "ollama" ? new OllamaModel({ model: modelName, ...(process.env.OLLAMA_BASE_URL ? { baseUrl: process.env.OLLAMA_BASE_URL } : {}) }) : undefined;
  if (!model) throw new Error(`Unsupported provider: ${provider}`);
  if (provider === "openai" && !process.env.OPENAI_API_KEY || provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) throw new Error(`Set the ${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} environment variable`);
  const workspace = arg("--workspace");
  const tools = workspace ? createFilesystemTools(workspace) : [];
  const approvalPolicy = { async decide(request: { toolName: string; description: string; risk: string; arguments: unknown }): Promise<"allow" | "deny"> {
    if (!process.stdin.isTTY || !process.stderr.isTTY) return "deny";
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try { return (await rl.question(`Allow ${request.risk} tool ${request.toolName} — ${request.description}; arguments ${JSON.stringify(request.arguments)}? [y/N] `)).trim().toLowerCase() === "y" ? "allow" : "deny"; }
    finally { rl.close(); }
  } };
  const result = await runAgent({ model, tools, approvalPolicy, ...(workspace ? { workspace } : {}), onEvent: event => { if (process.env.AGENT_HARNESS_DEBUG) process.stderr.write(`${JSON.stringify(event)}\n`); } }, prompt);
  if (result.status === "completed") process.stdout.write(`${result.output}\n`);
  else { process.stderr.write(`${result.status}: ${"reason" in result ? result.reason : "cancelled"}\n`); process.exitCode = 1; }
}
function readStdin(): Promise<string> { return new Promise((resolve, reject) => { let value = ""; process.stdin.setEncoding("utf8").on("data", chunk => value += chunk).on("end", () => resolve(value)).on("error", reject); }); }
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "Execution failed"}\n`); process.exitCode = 1; });
