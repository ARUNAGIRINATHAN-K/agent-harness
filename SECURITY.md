# Security Policy

## Reporting

Please do not report vulnerabilities in public issues. Contact the repository maintainers privately with a description, impact, and a way to reproduce the issue. Do not include real credentials or sensitive user data.

## Security boundaries

Model output, arguments, provider responses, MCP results, and tool output are untrusted. The runtime validates tool arguments, denies unregistered tools, and applies approval decisions to side-effecting tools. Approval policies are application supplied.

Workspace tools normalize paths and resolve symlinks to reduce path escapes. This is not a secure filesystem sandbox and is vulnerable to races with hostile local processes. Command presets use fixed executables and argv with `shell: false`; process termination on timeout or cancellation is best effort. Neither feature isolates hostile code. Use a dedicated OS/container/remote sandbox for that requirement.

Provider credentials should be supplied through application configuration or environment variables and must not be returned in tool output or logs. Event observers should avoid recording prompts, tool arguments, or other sensitive content.
