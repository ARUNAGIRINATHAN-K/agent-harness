import test from "node:test";
import assert from "node:assert/strict";
import { createMCPTools } from "../src/mcp/index.js";

test("adapts MCP tools as external tools using the remote schema", async () => {
  let call: unknown;
  const tools = await createMCPTools({
    async listTools() { return { tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } }] }; },
    async callTool(input) { call = input; return { content: [{ type: "text", text: "value" }] }; }
  });
  assert.equal(tools[0]!.name, "mcp_lookup");
  assert.equal(tools[0]!.risk, "external");
  assert.deepEqual(await tools[0]!.execute({ key: "x" }, { signal: new AbortController().signal }), { ok: true, content: { content: [{ type: "text", text: "value" }] } });
  assert.deepEqual(call, { name: "lookup", arguments: { key: "x" } });
});
