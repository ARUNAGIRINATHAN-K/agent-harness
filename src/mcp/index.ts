import type { JsonSchema, Tool, ToolResult } from "../core/types.js";
export interface MCPToolDescription { name: string; description?: string; inputSchema?: JsonSchema }
export interface MCPClient {
  listTools(): Promise<{ tools: readonly MCPToolDescription[] }>;
  callTool(input: { name: string; arguments: unknown }): Promise<unknown>;
}
export async function createMCPTools(client: MCPClient, prefix = "mcp"): Promise<Tool[]> {
  const { tools } = await client.listTools();
  return tools.map(remote => {
    const name = `${prefix}_${remote.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    return {
      name, description: remote.description ?? `MCP tool ${remote.name}`,
      inputSchema: remote.inputSchema ?? { type: "object" }, risk: "external" as const,
      execute: async (args: unknown): Promise<ToolResult> => {
        try { return { ok: true, content: await client.callTool({ name: remote.name, arguments: args }) }; }
        catch { return { ok: false, error: { code: "MCP_FAILURE", message: "MCP tool call failed" } }; }
      }
    };
  });
}
