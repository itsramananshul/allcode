# Security

All Code starts coding agents with access to the current workspace. Review the permissions configured in each agent before using it on sensitive repositories.

## Workspace boundary

Delegated tasks are restricted by `ALL_CODE_ALLOWED_ROOTS`. Paths are resolved with `realpath` before the boundary check, and Windows paths are compared case-insensitively.

```powershell
$env:ALL_CODE_ALLOWED_ROOTS = "C:\work\project"
allcode
```

Use `;` between roots on Windows and `:` on macOS or Linux.

## Agent permissions

- Claude Code starts in `acceptEdits` mode. When it requests an approval, All Code presents the action and waits for your decision.
- OpenCode starts with its native permission rules. Select `/mode` → Ask to review its pending permissions inside All Code. Explicit deny entries in `OPENCODE_CONFIG_CONTENT` are preserved when All Code adds the Ask rule.
- Codex starts with the `workspace-write` sandbox and an on-request approval policy in the interactive workspace.
- Hermes starts in ACP `default` mode. Its ACP permission requests appear in All Code's approve/deny pane; without an interactive approver, All Code denies the request. Hermes's own configured provider and tool policies still apply.

`/mode` also exposes each provider's auto-approve or bypass choices where available. They are opt-in and require a second confirmation. Bypass removes protections; use it only in an environment you trust. Managed provider policies can still refuse an action.

All Code's approval prompt defaults to Deny. It displays the provider's tool input, command, or file change in a scrollable review window. Escape denies. If the approval transport fails, the request is denied rather than silently approved.

The one-shot `allcode run` command and background MCP-delegated tasks remain headless. They do not show All Code's approval prompt; actions requiring a human decision in those paths are subject to each adapter's non-interactive defaults.

## Credentials

Authentication stays in the native CLI stores. Prompts and task results may still contain sensitive information, so protect `.allcode/session.json` and do not commit it.

## Delegation depth

Nested agent calls stop at `ALL_CODE_MAX_DEPTH`, which defaults to `3`. The depth and current host are passed to child processes through `ALL_CODE_DEPTH` and `ALL_CODE_HOST`.

## Process execution

All Code uses direct process spawning. Model IDs and session IDs are validated before they become command arguments. Captured output is limited to eight MiB per process.

## Vulnerability reports

Follow the private reporting instructions in [SECURITY.md](../SECURITY.md).
