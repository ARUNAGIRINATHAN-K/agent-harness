export type Risk = "read" | "write" | "command" | "external";
export type Role = "system" | "user" | "assistant" | "tool";
export type JsonSchema = Record<string, unknown> | boolean;

export interface ToolCall { id: string; name: string; arguments: unknown }
export interface ChatMessage {
  role: Role;
  content: string;
  toolCallId?: string;
  toolCalls?: readonly ToolCall[];
}
export interface ModelRequest {
  messages: readonly ChatMessage[];
  tools: readonly ModelTool[];
}
export interface ModelTool { name: string; description: string; inputSchema: JsonSchema }
export interface ModelUsage { inputTokens?: number; outputTokens?: number }
export interface ModelResponse { message: ChatMessage; usage?: ModelUsage }
export interface Model {
  generate(request: ModelRequest, options: { signal: AbortSignal }): Promise<ModelResponse>;
}

export type ToolResult =
  | { ok: true; content: unknown }
  | { ok: false; error: { code: string; message: string } };
export interface ToolContext {
  signal: AbortSignal;
  workspace?: string;
}
export interface Tool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  risk: Risk;
  execute(args: unknown, context: ToolContext): Promise<ToolResult>;
}
export interface ApprovalRequest { toolName: string; description: string; risk: Risk; arguments: unknown }
export interface ApprovalPolicy { decide(input: ApprovalRequest, options: { signal: AbortSignal }): Promise<"allow" | "deny"> }
export interface ExecutionLimits {
  maxModelCalls?: number;
  maxToolCalls?: number;
  maxSteps?: number;
  maxDurationMs?: number;
  maxOutputChars?: number;
}
export interface ContextPolicy { maxMessages?: number; maxContextChars?: number; maxToolInputChars?: number; maxToolOutputChars?: number }
export interface UsageSummary {
  inputTokens: number | null;
  outputTokens: number | null;
  modelCalls: number;
  toolCalls: number;
  reportedUsageCalls: number;
}
export type ExecutionEvent =
  | { type: "run.started"; at: number }
  | { type: "model.requested"; at: number; call: number }
  | { type: "model.responded"; at: number; call: number }
  | { type: "tool.started"; at: number; toolName: string; callId: string }
  | { type: "tool.completed"; at: number; toolName: string; callId: string; ok: boolean }
  | { type: "tool.rejected"; at: number; toolName: string; callId: string; reason: string }
  | { type: "run.completed"; at: number; status: string };
export interface AgentOptions {
  model: Model;
  tools: readonly Tool[];
  approvalPolicy?: ApprovalPolicy;
  limits?: ExecutionLimits;
  context?: ContextPolicy;
  workspace?: string;
  onEvent?: (event: ExecutionEvent) => void;
}
export type AgentResult =
  | { status: "completed"; output: string; usage: UsageSummary }
  | { status: "limit_reached"; reason: string; usage: UsageSummary }
  | { status: "cancelled"; usage: UsageSummary };
