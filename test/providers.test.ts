import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIModel } from "../src/providers/openai.js";
import { AnthropicModel } from "../src/providers/anthropic.js";
import { OllamaModel } from "../src/providers/ollama.js";

const request = { messages: [{ role: "user" as const, content: "hello" }], tools: [] };
const fakeFetch = (value: unknown) => (async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
test("OpenAI adapter maps assistant text and usage", async () => {
  const model = new OpenAIModel({ apiKey: "test", model: "fake", fetch: fakeFetch({ choices: [{ message: { role: "assistant", content: "hi" } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }) });
  assert.deepEqual(await model.generate(request, { signal: new AbortController().signal }), { message: { role: "assistant", content: "hi" }, usage: { inputTokens: 2, outputTokens: 1 } });
});
test("Anthropic adapter maps text and tool-use blocks", async () => {
  const model = new AnthropicModel({ apiKey: "test", model: "fake", fetch: fakeFetch({ content: [{ type: "text", text: "go" }, { type: "tool_use", id: "c1", name: "x", input: { a: 1 } }] }) });
  const response = await model.generate(request, { signal: new AbortController().signal });
  assert.deepEqual(response.message.toolCalls, [{ id: "c1", name: "x", arguments: { a: 1 } }]);
});
test("Ollama adapter maps local chat response", async () => {
  const model = new OllamaModel({ model: "fake", fetch: fakeFetch({ message: { role: "assistant", content: "local" }, prompt_eval_count: 3 }) });
  assert.deepEqual(await model.generate(request, { signal: new AbortController().signal }), { message: { role: "assistant", content: "local" }, usage: { inputTokens: 3 } });
});
