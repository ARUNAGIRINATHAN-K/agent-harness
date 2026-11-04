import type { Model, ModelRequest, ModelResponse } from "../core/types.js";
import { jsonRequest, openAiMessages, responseMessage, toolCalls, type FetchLike } from "./shared.js";
export interface OllamaOptions { model: string; baseUrl?: string; fetch?: FetchLike; format?: "json" }
export class OllamaModel implements Model {
  private readonly fetcher: FetchLike;
  constructor(private readonly options: OllamaOptions) { this.fetcher = options.fetch ?? fetch; }
  async generate(request: ModelRequest, { signal }: { signal: AbortSignal }): Promise<ModelResponse> {
    const body = await jsonRequest(this.fetcher, `${(this.options.baseUrl ?? "http://127.0.0.1:11434/api").replace(/\/$/, "")}/chat`, {
      method: "POST", signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.options.model, stream: false, ...(this.options.format ? { format: this.options.format } : {}), messages: openAiMessages(request), tools: request.tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) })
    });
    const message = body.message as Record<string, unknown> | undefined;
    if (!message) throw new Error("Ollama response has no message");
    return { message: responseMessage(typeof message.content === "string" ? message.content : "", toolCalls(message.tool_calls)), ...(typeof body.prompt_eval_count === "number" || typeof body.eval_count === "number" ? { usage: { ...(typeof body.prompt_eval_count === "number" ? { inputTokens: body.prompt_eval_count } : {}), ...(typeof body.eval_count === "number" ? { outputTokens: body.eval_count } : {}) } } : {}) };
  }
}
