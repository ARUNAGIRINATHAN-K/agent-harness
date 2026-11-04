import type { Model, ModelRequest, ModelResponse } from "../core/types.js";
import { jsonRequest, parseArgs, type FetchLike } from "./shared.js";
export interface AnthropicOptions { apiKey: string; model: string; baseUrl?: string; fetch?: FetchLike; maxTokens?: number; version?: string }
export class AnthropicModel implements Model {
  private readonly fetcher: FetchLike;
  constructor(private readonly options: AnthropicOptions) { this.fetcher = options.fetch ?? fetch; }
  async generate(request: ModelRequest, { signal }: { signal: AbortSignal }): Promise<ModelResponse> {
    const system = request.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
    const messages = request.messages.filter(m => m.role !== "system").map(m => m.role === "tool" ? { role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }] } : ({ role: m.role, content: [ ...(m.content ? [{ type: "text", text: m.content }] : []), ...(m.toolCalls ?? []).map(c => ({ type: "tool_use", id: c.id, name: c.name, input: c.arguments })) ] }));
    const body = await jsonRequest(this.fetcher, `${(this.options.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "")}/messages`, {
      method: "POST", signal, headers: { "content-type": "application/json", "x-api-key": this.options.apiKey, "anthropic-version": this.options.version ?? "2023-06-01" },
      body: JSON.stringify({ model: this.options.model, max_tokens: this.options.maxTokens ?? 4096, ...(system ? { system } : {}), messages, tools: request.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) })
    });
    const content = Array.isArray(body.content) ? body.content : [];
    const text = content.filter((b): b is Record<string, unknown> => !!b && typeof b === "object" && (b as Record<string, unknown>).type === "text").map(b => typeof b.text === "string" ? b.text : "").join("");
    const calls = content.flatMap((b, i) => b && typeof b === "object" && (b as Record<string, unknown>).type === "tool_use" ? [{ id: String((b as Record<string, unknown>).id ?? `call_${i}`), name: String((b as Record<string, unknown>).name ?? ""), arguments: parseArgs((b as Record<string, unknown>).input) }] : []);
    const u = body.usage as Record<string, unknown> | undefined;
    const usage = u && (typeof u.input_tokens === "number" || typeof u.output_tokens === "number") ? { ...(typeof u.input_tokens === "number" ? { inputTokens: u.input_tokens } : {}), ...(typeof u.output_tokens === "number" ? { outputTokens: u.output_tokens } : {}) } : undefined;
    return { message: { role: "assistant", content: text, ...(calls.length ? { toolCalls: calls } : {}) }, ...(usage ? { usage } : {}) };
  }
}
