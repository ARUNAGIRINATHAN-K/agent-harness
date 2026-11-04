# Changelog

All notable changes to this project will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added
- Initial provider-independent AI agent execution runtime.
- Extensible tool registry with argument schema validation.
- Human-in-the-loop approval workflows and configurable permission policies.
- Execution controls, including step budgets, tool-call limits, timeouts, and cancellation.
- Bounded conversation context and tool-output management.
- Workspace-restricted filesystem operations.
- Named command presets for controlled command execution.
- Pluggable model provider adapters.
- Optional Model Context Protocol (MCP) integration.
- Command-line interface (CLI) for running and inspecting agents.
- Deterministic test infrastructure using scripted fake models.
- Unit and integration test coverage for core execution workflows.

### Documentation
- Project overview and architecture documentation.
- Installation and getting-started guides.
- Tool and provider development guides.
- Security model and responsible disclosure policy.
- Contribution guidelines and community standards.

### Security
- Configurable tool permissions and approval requirements.
- Input validation for tool arguments.
- Execution boundaries and resource limits.
- Explicit documentation of filesystem and command execution security limitations.

---

**Note:** This is an unreleased development version. Features and APIs may change before the first stable release.