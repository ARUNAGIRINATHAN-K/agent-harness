import { HarnessError } from "./errors.js";
import { validateTool } from "./schema.js";
import type { AgentOptions, AgentResult, ChatMessage, ExecutionEvent, Tool, UsageSummary } from "./types.js";

const DEFAULT_LIMITS = { maxModelCalls: 20, maxToolCalls: 40, maxSteps: 50, maxDurationMs: 120_000, maxOutputChars: 1_000_000 };
const DEFAULT_CONTEXT = { maxMessages: 80, maxContextChars: 100_000, maxToolInputChars: 64_000, maxToolOutputChars: 12_000 };
const NEEDS_APPROVAL = new Set(["write", "command", "external"]);

export async function runAgent(options: AgentOptions, input: string, runOptions: { signal?: AbortSignal } = {}): Promise<AgentResult> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const contextPolicy = { ...DEFAULT_CONTEXT, ...options.context };
  for (const [key, value] of Object.entries(limits)) {
    const minimum = key === "maxOutputChars" ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum) throw new HarnessError("INVALID_OPTIONS", `${key} must be an integer of at least ${minimum}`);
  }
  for (const [key, value] of Object.entries(contextPolicy)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new HarnessError("INVALID_OPTIONS", `${key} must be a positive integer`);
  }
  const tools = new Map<string, Tool>();
  for (const tool of options.tools) {
    if (!tool.name || tools.has(tool.name)) throw new HarnessError("INVALID_TOOL_REGISTRY", `Duplicate or empty tool name: ${tool.name}`);
    tools.set(tool.name, { ...tool, inputSchema: structuredClone(tool.inputSchema) });
  }
  const started = Date.now();
  const controller = new AbortController();
  let deadlineExceeded = false;
  const onAbort = () => controller.abort(runOptions.signal?.reason);
  runOptions.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => { deadlineExceeded = true; controller.abort(new Error("Execution deadline exceeded")); }, limits.maxDurationMs);
  if (runOptions.signal?.aborted) controller.abort(runOptions.signal.reason);
  const usage: UsageSummary = { inputTokens: null, outputTokens: null, modelCalls: 0, toolCalls: 0, reportedUsageCalls: 0 };
  let inputUsageKnown = true, outputUsageKnown = true;
  let inputTokenTotal = 0, outputTokenTotal = 0;
  let outputChars = 0;
  const emit = (event: ExecutionEvent) => { try { options.onEvent?.(event); } catch { /* observers cannot break execution */ } };
  const finish = (result: AgentResult): AgentResult => { emit({ type: "run.completed", at: Date.now(), status: result.status }); return result; };
  const messages: ChatMessage[] = [{ role: "user", content: input }];
  emit({ type: "run.started", at: started });
  try {
    for (let step = 0; step < limits.maxSteps; step++) {
      if (controller.signal.aborted) return finish(abortedResult(deadlineExceeded, usage));
      if (Date.now() - started >= limits.maxDurationMs) return finish({ status: "limit_reached", reason: "deadline", usage });
      if (usage.modelCalls >= limits.maxModelCalls) return finish({ status: "limit_reached", reason: "model_calls", usage });
      const requestMessages = boundMessages(messages, contextPolicy.maxMessages, contextPolicy.maxContextChars).map(message => ({
        ...message, ...(message.toolCalls ? { toolCalls: message.toolCalls.map(call => ({ ...call, arguments: structuredClone(call.arguments) })) } : {})
      }));
      usage.modelCalls++;
      emit({ type: "model.requested", at: Date.now(), call: usage.modelCalls });
      let response;
      try { response = await options.model.generate({ messages: requestMessages, tools: [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema: structuredClone(inputSchema) })) }, { signal: controller.signal }); }
      catch (error) {
        if (controller.signal.aborted) return finish(abortedResult(deadlineExceeded, usage));
        throw new HarnessError("MODEL_FAILURE", "Model request failed", { cause: error });
      }
      if (!response || typeof response !== "object" || !response.message || (response.usage !== undefined && (!response.usage || typeof response.usage !== "object" || [response.usage.inputTokens, response.usage.outputTokens].some(value => value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0))))) {
        throw new HarnessError("INVALID_MODEL_RESPONSE", "Model returned an invalid response");
      }
      emit({ type: "model.responded", at: Date.now(), call: usage.modelCalls });
      if (response.usage) {
        usage.reportedUsageCalls++;
        if (response.usage.inputTokens === undefined) inputUsageKnown = false;
        else inputTokenTotal += response.usage.inputTokens;
        if (response.usage.outputTokens === undefined) outputUsageKnown = false;
        else outputTokenTotal += response.usage.outputTokens;
        usage.inputTokens = inputUsageKnown ? inputTokenTotal : null;
        usage.outputTokens = outputUsageKnown ? outputTokenTotal : null;
      } else {
        inputUsageKnown = false; outputUsageKnown = false;
        usage.inputTokens = null; usage.outputTokens = null;
      }
      if (controller.signal.aborted) return finish(abortedResult(deadlineExceeded, usage));
      let message;
      try { message = structuredClone(response.message); }
      catch { throw new HarnessError("INVALID_MODEL_RESPONSE", "Model returned non-JSON response data"); }
      if (!message || message.role !== "assistant" || typeof message.content !== "string" || (message.toolCalls !== undefined && !Array.isArray(message.toolCalls))) {
        throw new HarnessError("INVALID_MODEL_RESPONSE", "Model returned an invalid response");
      }
      if (message.toolCalls?.some(call => !call || typeof call.id !== "string" || typeof call.name !== "string" || !call.name)) throw new HarnessError("INVALID_MODEL_RESPONSE", "Model returned a malformed tool call");
      messages.push(message);
      outputChars += message.content.length;
      if (outputChars > limits.maxOutputChars) return finish({ status: "limit_reached", reason: "output_chars", usage });
      if (!message.toolCalls?.length) return finish({ status: "completed", output: message.content, usage });
      for (const call of message.toolCalls) {
        if (controller.signal.aborted) return finish(abortedResult(deadlineExceeded, usage));
        if (usage.toolCalls >= limits.maxToolCalls) return finish({ status: "limit_reached", reason: "tool_calls", usage });
        usage.toolCalls++;
        const tool = tools.get(call.name);
        if (!tool) {
          emit({ type: "tool.rejected", at: Date.now(), toolName: call.name, callId: call.id, reason: "unknown_tool" });
          messages.push(toolMessage(call.id, { ok: false, error: { code: "UNKNOWN_TOOL", message: "Tool is not registered" } }));
          continue;
        }
        if (safeStringify(call.arguments).length > contextPolicy.maxToolInputChars) {
          emit({ type: "tool.rejected", at: Date.now(), toolName: tool.name, callId: call.id, reason: "arguments_too_large" });
          messages.push(toolMessage(call.id, { ok: false, error: { code: "ARGUMENTS_TOO_LARGE", message: "Tool arguments exceed the configured limit" } }));
          continue;
        }
        const schemaError = validateTool(tool, call.arguments);
        if (schemaError) {
          emit({ type: "tool.rejected", at: Date.now(), toolName: tool.name, callId: call.id, reason: "invalid_arguments" });
          messages.push(toolMessage(call.id, { ok: false, error: { code: "INVALID_ARGUMENTS", message: schemaError } }));
          continue;
        }
        if (NEEDS_APPROVAL.has(tool.risk)) {
          let decision: "allow" | "deny" = "deny";
          if (options.approvalPolicy) {
            try { decision = await waitForApproval(options.approvalPolicy, { toolName: tool.name, description: tool.description, risk: tool.risk, arguments: structuredClone(call.arguments) }, controller.signal); }
            catch { if (controller.signal.aborted) return finish(abortedResult(deadlineExceeded, usage)); }
          }
          if (decision !== "allow") {
            emit({ type: "tool.rejected", at: Date.now(), toolName: tool.name, callId: call.id, reason: "approval_denied" });
            messages.push(toolMessage(call.id, { ok: false, error: { code: "APPROVAL_DENIED", message: "Approval was denied or no approval policy is configured" } }));
            continue;
          }
        }
        emit({ type: "tool.started", at: Date.now(), toolName: tool.name, callId: call.id });
        let result;
        try { result = normalizeToolResult(await tool.execute(structuredClone(call.arguments), { signal: controller.signal, ...(options.workspace === undefined ? {} : { workspace: options.workspace }) })); }
        catch { result = { ok: false as const, error: { code: "TOOL_FAILURE", message: "Tool execution failed" } }; }
        const serialized = safeStringify(result);
        const bounded = serialized.length > contextPolicy.maxToolOutputChars ? `${serialized.slice(0, contextPolicy.maxToolOutputChars)}… [output truncated]` : serialized;
        outputChars += bounded.length;
        if (outputChars > limits.maxOutputChars) return finish({ status: "limit_reached", reason: "output_chars", usage });
        emit({ type: "tool.completed", at: Date.now(), toolName: tool.name, callId: call.id, ok: result.ok });
        messages.push({ role: "tool", toolCallId: call.id, content: bounded });
      }
    }
    return finish({ status: "limit_reached", reason: "steps", usage });
  } finally {
    clearTimeout(timer);
    runOptions.signal?.removeEventListener("abort", onAbort);
  }
}

function toolMessage(id: string, value: unknown): ChatMessage { return { role: "tool", toolCallId: id, content: safeStringify(value) }; }
async function waitForApproval(policy: NonNullable<AgentOptions["approvalPolicy"]>, request: { toolName: string; description: string; risk: import("./types.js").Risk; arguments: unknown }, signal: AbortSignal): Promise<"allow" | "deny"> {
  if (signal.aborted) throw signal.reason;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Execution aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([policy.decide(request, { signal }), aborted]); }
  finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
}
function abortedResult(deadlineExceeded: boolean, usage: UsageSummary): AgentResult {
  return deadlineExceeded ? { status: "limit_reached", reason: "deadline", usage } : { status: "cancelled", usage };
}
function safeStringify(value: unknown): string { try { return JSON.stringify(value) ?? "null"; } catch { return "[unserializable tool result]"; } }
function normalizeToolResult(value: unknown): import("./types.js").ToolResult {
  if (!value || typeof value !== "object" || typeof (value as { ok?: unknown }).ok !== "boolean") return { ok: false, error: { code: "INVALID_TOOL_RESULT", message: "Tool returned an invalid result" } };
  const result = value as { ok: boolean; content?: unknown; error?: { code?: unknown; message?: unknown } };
  if (result.ok) return { ok: true, content: result.content };
  const code = typeof result.error?.code === "string" ? result.error.code.slice(0, 100) : "TOOL_FAILURE";
  const message = typeof result.error?.message === "string" ? result.error.message.slice(0, 2_000) : "Tool execution failed";
  return { ok: false, error: { code, message } };
}
function boundMessages(messages: readonly ChatMessage[], maxMessages: number, maxChars: number): ChatMessage[] {
  let result = messages.slice(-maxMessages);
  let chars = result.reduce((n, m) => n + m.content.length, 0);
  while (result.length > 1 && chars > maxChars) { const removed = result.shift(); if (removed) chars -= removed.content.length; }
  return result.map(m => m.content.length > maxChars ? { ...m, content: `${m.content.slice(0, maxChars)}… [context truncated]` } : m);
}
