import type { Model, ModelRequest, ModelResponse } from "../core/types.js";
import { jsonRequest, openAiMessages, responseMessage, toolCalls, type FetchLike } from "./shared.js";
export interface OpenAIOptions { apiKey: string; model: string; baseUrl?: string; fetch?: FetchLike; organization?: string }
export class OpenAIModel implements Model {
  private readonly fetcher: FetchLike;
  constructor(private readonly options: OpenAIOptions) { this.fetcher = options.fetch ?? fetch; }
  async generate(request: ModelRequest, { signal }: { signal: AbortSignal }): Promise<ModelResponse> {
    const body = await jsonRequest(this.fetcher, `${(this.options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`, {
      method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}`, ...(this.options.organization ? { "openai-organization": this.options.organization } : {}) },
      body: JSON.stringify({ model: this.options.model, messages: openAiMessages(request), tools: request.tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) })
    });
    const choices = body.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    if (!message) throw new Error("OpenAI response has no assistant message");
    const calls = toolCalls(message.tool_calls);
    const usage = parseOpenAiUsage(body.usage);
    return { message: responseMessage(typeof message.content === "string" ? message.content : "", calls), ...(usage ? { usage } : {}) };
  }
}
function parseOpenAiUsage(value: unknown): ModelResponse["usage"] { if (!value || typeof value !== "object") return undefined; const v = value as Record<string, unknown>; const input = v.prompt_tokens, output = v.completion_tokens; return typeof input === "number" || typeof output === "number" ? { ...(typeof input === "number" ? { inputTokens: input } : {}), ...(typeof output === "number" ? { outputTokens: output } : {}) } : undefined; }
