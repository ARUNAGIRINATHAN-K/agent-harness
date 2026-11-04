import test from "node:test";
import assert from "node:assert/strict";
import { runAgent, type Model, type Tool } from "../src/index.js";

function scripted(...responses: Awaited<ReturnType<Model["generate"]>>[]): Model {
  let i = 0;
  return { async generate() { const response = responses[i++]; if (!response) throw new Error("No scripted response"); return response; } };
}
const readTool: Tool = { name: "echo", description: "Echo input", risk: "read", inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false }, async execute(args) { return { ok: true, content: (args as { value: string }).value }; } };

test("completes with a fake model without network or credentials", async () => {
  const result = await runAgent({ model: scripted({ message: { role: "assistant", content: "done" } }), tools: [] }, "hello");
  assert.equal(result.status, "completed");
  if (result.status === "completed") assert.equal(result.output, "done");
});
test("executes repeated tool calls and accounts for usage", async () => {
  const result = await runAgent({ model: scripted(
    { message: { role: "assistant", content: "", toolCalls: [{ id: "1", name: "echo", arguments: { value: "a" } }] }, usage: { inputTokens: 4, outputTokens: 2 } },
    { message: { role: "assistant", content: "finished" }, usage: { inputTokens: 3, outputTokens: 1 } }
  ), tools: [readTool] }, "go");
  assert.equal(result.status, "completed");
  assert.deepEqual(result.usage, { inputTokens: 7, outputTokens: 3, modelCalls: 2, toolCalls: 1, reportedUsageCalls: 2 });
});
test("validates the complete schema before invoking a tool", async () => {
  let invoked = false;
  const model = scripted({ message: { role: "assistant", content: "", toolCalls: [{ id: "1", name: "echo", arguments: { value: "x", extra: true } }] } }, { message: { role: "assistant", content: "recovered" } });
  const result = await runAgent({ model, tools: [{ ...readTool, async execute() { invoked = true; return { ok: true, content: null }; } }] }, "go");
  assert.equal(invoked, false);
  assert.equal(result.status, "completed");
});
test("model adapters cannot mutate the runtime's tool validation policy", async () => {
  let invoked = false;
  let calls = 0;
  const model: Model = { async generate(request) {
    calls++;
    if (calls === 1) {
      request.tools[0]!.inputSchema = true;
      return { message: { role: "assistant", content: "", toolCalls: [{ id: "1", name: "echo", arguments: { value: "x", injected: true } }] } };
    }
    return { message: { role: "assistant", content: "safe" } };
  } };
  const result = await runAgent({ model, tools: [{ ...readTool, async execute() { invoked = true; return { ok: true, content: null }; } }] }, "go");
  assert.equal(result.status, "completed");
  assert.equal(invoked, false);
});
test("supports JSON Schema conditional keywords and format validation", async () => {
  const schemaTool: Tool = { ...readTool, inputSchema: {
    type: "object", properties: { mode: { enum: ["date", "text"] }, value: {} }, required: ["mode", "value"], additionalProperties: false,
    if: { properties: { mode: { const: "date" } }, required: ["mode"] }, then: { properties: { value: { type: "string", format: "date-time" } } },
    else: { properties: { value: { type: "string", minLength: 2 } } }
  } };
  let invoked = 0;
  const model = scripted(
    { message: { role: "assistant", content: "", toolCalls: [{ id: "1", name: "echo", arguments: { mode: "date", value: "tomorrow" } }] } },
    { message: { role: "assistant", content: "", toolCalls: [{ id: "2", name: "echo", arguments: { mode: "date", value: "2026-11-04T10:00:00Z" } }] } },
    { message: { role: "assistant", content: "ok" } }
  );
  const result = await runAgent({ model, tools: [{ ...schemaTool, async execute() { invoked++; return { ok: true, content: null }; } }] }, "go");
  assert.equal(result.status, "completed");
  assert.equal(invoked, 1);
});
test("denies side-effecting tools if approval is not configured", async () => {
  let invoked = false;
  const writeTool: Tool = { ...readTool, risk: "write", async execute() { invoked = true; return { ok: true, content: null }; } };
  const result = await runAgent({ model: scripted({ message: { role: "assistant", content: "", toolCalls: [{ id: "1", name: "echo", arguments: { value: "x" } }] } }, { message: { role: "assistant", content: "denied" } }), tools: [writeTool] }, "go");
  assert.equal(invoked, false);
  assert.equal(result.status, "completed");
});
test("passes side-effecting tools only after explicit approval", async () => {
  let invoked = false;
  const tool: Tool = { ...readTool, description: "Write a report", risk: "write", async execute() { invoked = true; return { ok: true, content: "written" }; } };
  const result = await runAgent({
    model: scripted({ message: { role: "assistant", content: "", toolCalls: [{ id: "1", name: "echo", arguments: { value: "x" } }] } }, { message: { role: "assistant", content: "done" } }),
    tools: [tool], approvalPolicy: { async decide(request) { assert.equal(request.description, "Write a report"); return "allow"; } }
  }, "go");
  assert.equal(result.status, "completed");
  assert.equal(invoked, true);
});
test("bounds tool output and emits structured events", async () => {
  const events: string[] = [];
  const largeTool: Tool = { ...readTool, async execute() { return { ok: true, content: "x".repeat(100) }; } };
  const result = await runAgent({ model: scripted({ message: { role: "assistant", content: "", toolCalls: [{ id: "1", name: "echo", arguments: { value: "x" } }] } }, { message: { role: "assistant", content: "ok" } }), tools: [largeTool], context: { maxToolOutputChars: 20 }, onEvent: e => events.push(e.type) }, "go");
  assert.equal(result.status, "completed");
  assert.deepEqual(events, ["run.started", "model.requested", "model.responded", "tool.started", "tool.completed", "model.requested", "model.responded", "run.completed"]);
});
test("rejects oversized tool arguments before execution", async () => {
  let invoked = false;
  const model = scripted({ message: { role: "assistant", content: "", toolCalls: [{ id: "1", name: "echo", arguments: { value: "too large" } }] } }, { message: { role: "assistant", content: "rejected" } });
  const result = await runAgent({ model, tools: [{ ...readTool, async execute() { invoked = true; return { ok: true, content: null }; } }], context: { maxToolInputChars: 4 } }, "go");
  assert.equal(result.status, "completed");
  assert.equal(invoked, false);
});
test("returns limit status when call budgets are exhausted", async () => {
  const result = await runAgent({ model: scripted({ message: { role: "assistant", content: "never final", toolCalls: [{ id: "1", name: "echo", arguments: { value: "x" } }] } }), tools: [readTool], limits: { maxModelCalls: 1 } }, "go");
  assert.deepEqual(result.status, "limit_reached");
});
test("keeps unreported usage explicitly unknown", async () => {
  const result = await runAgent({ model: scripted({ message: { role: "assistant", content: "ok" }, usage: { inputTokens: 3 } }), tools: [] }, "go");
  assert.equal(result.usage.inputTokens, 3);
  assert.equal(result.usage.outputTokens, null);
});
test("cooperative cancellation returns a cancelled result", async () => {
  const controller = new AbortController();
  const model: Model = { async generate() { controller.abort(); return { message: { role: "assistant", content: "late" } }; } };
  const result = await runAgent({ model, tools: [] }, "go", { signal: controller.signal });
  assert.equal(result.status, "cancelled");
});
test("deadline aborts in-flight model work and reports the budget outcome", async () => {
  const model: Model = { async generate(_request, { signal }) {
    return await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } };
  const result = await runAgent({ model, tools: [], limits: { maxDurationMs: 5 } }, "go");
  assert.deepEqual([result.status, result.status === "limit_reached" ? result.reason : undefined], ["limit_reached", "deadline"]);
});
test("contains malformed tool results", async () => {
  const model = scripted({ message: { role: "assistant", content: "", toolCalls: [{ id: "1", name: "echo", arguments: { value: "x" } }] } }, { message: { role: "assistant", content: "ok" } });
  const result = await runAgent({ model, tools: [{ ...readTool, async execute() { return null as never; } }] }, "go");
  assert.equal(result.status, "completed");
});
