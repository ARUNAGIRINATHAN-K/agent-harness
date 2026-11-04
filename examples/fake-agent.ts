import { runAgent, type Model } from "../src/index.js";
const model: Model = { async generate() { return { message: { role: "assistant", content: "Hello from a deterministic fake model." } }; } };
const result = await runAgent({ model, tools: [] }, "Say hello");
console.log(result);
