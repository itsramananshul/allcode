# Security model

All Code launches coding agents that can modify files and run commands. Treat every enabled agent and MCP server as code with your user account's authority.

## Boundaries

- Credentials remain in each native CLI's storage. All Code does not copy, exchange, log, or emulate them.
- Child processes are spawned directly without an intermediary command shell.
- Codex uses its `workspace-write` sandbox.
- Claude Code uses `acceptEdits`; All Code does not select bypass-permission mode.
- OpenCode retains the permissions configured in OpenCode.
- Delegated task directories must resolve beneath `ALL_CODE_ALLOWED_ROOTS`.
- Delegation depth defaults to three to stop accidental agent-to-agent loops.
- Captured subprocess output is bounded to eight MiB.

## Recommended setup

Set a narrow root before exposing the broker manually:

```powershell
$env:ALL_CODE_ALLOWED_ROOTS = "C:\work\my-project"
allcode
```

Do not place API keys in prompts. Use the official credential mechanism for the relevant CLI. Review third-party MCP servers before enabling them, and do not run All Code in a directory containing secrets an agent should not inspect.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md). Do not open a public issue containing exploit details, credentials, or private logs.
