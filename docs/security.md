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

- Claude Code runs in `acceptEdits` mode. Operations that still require a prompt are denied in non-interactive execution.
- OpenCode uses the permissions in its OpenCode configuration.
- Codex runs with the `workspace-write` sandbox.

All Code does not select bypass-permission modes.

## Credentials

Authentication stays in the native CLI stores. Prompts and task results may still contain sensitive information, so protect `.allcode/session.json` and do not commit it.

## Delegation depth

Nested agent calls stop at `ALL_CODE_MAX_DEPTH`, which defaults to `3`. The depth and current host are passed to child processes through `ALL_CODE_DEPTH` and `ALL_CODE_HOST`.

## Process execution

All Code uses direct process spawning. Model IDs and session IDs are validated before they become command arguments. Captured output is limited to eight MiB per process.

## Vulnerability reports

Follow the private reporting instructions in [SECURITY.md](../SECURITY.md).
