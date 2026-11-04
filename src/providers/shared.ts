import type { ChatMessage, ModelRequest, ModelResponse, ToolCall } from "../core/types.js";
export type FetchLike = typeof fetch;
export async function jsonRequest(fetcher: FetchLike, url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetcher(url, init);
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provider returned malformed JSON");
  return value as Record<string, unknown>;
}
export function asString(value: unknown): string { return typeof value === "string" ? value : ""; }
export function parseArgs(value: unknown): unknown { if (typeof value !== "string") return value ?? {}; try { return JSON.parse(value) as unknown; } catch { return value; } }
export function toolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const v = item as Record<string, unknown>;
    const fn = v.function && typeof v.function === "object" ? v.function as Record<string, unknown> : v;
    const name = asString(fn.name);
    if (!name) return [];
    return [{ id: asString(v.id) || `call_${index}`, name, arguments: parseArgs(fn.arguments ?? fn.input) }];
  });
}
export function openAiMessages(request: ModelRequest): unknown[] {
  return request.messages.map(m => ({ role: m.role === "tool" ? "tool" : m.role, content: m.content, ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}), ...(m.toolCalls ? { tool_calls: m.toolCalls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}) }));
}
export function responseMessage(content: string, calls: ToolCall[]): ChatMessage { return { role: "assistant", content, ...(calls.length ? { toolCalls: calls } : {}) }; }
export function numericUsage(value: unknown): ModelResponse["usage"] {
  if (!value || typeof value !== "object") return undefined;
  const u = value as Record<string, unknown>;
  const inputTokens = typeof u.prompt_tokens === "number" ? u.prompt_tokens : typeof u.input_tokens === "number" ? u.input_tokens : typeof u.prompt_eval_count === "number" ? u.prompt_eval_count : undefined;
  const outputTokens = typeof u.completion_tokens === "number" ? u.completion_tokens : typeof u.output_tokens === "number" ? u.output_tokens : typeof u.eval_count === "number" ? u.eval_count : undefined;
  return inputTokens === undefined && outputTokens === undefined ? undefined : { ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }) };
}
