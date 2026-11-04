import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { Tool } from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats.default(ajv);
export function validateTool(tool: Tool, args: unknown): string | undefined {
  try {
    const validate = ajv.compile(tool.inputSchema);
    if (validate(args)) return undefined;
    return ajv.errorsText(validate.errors, { separator: "; " });
  } catch (error) {
    return `Invalid tool schema: ${error instanceof Error ? error.message : String(error)}`;
  }
}
