# Troubleshooting

## `allcode` is not found

Rebuild and recreate the global link:

```bash
npm install
npm link
```

Open a new terminal and run:

```bash
allcode agents
```

## An agent is marked unavailable

Run `allcode agents` and check the reported executable path. Set an explicit path when the executable is outside `PATH`:

```powershell
$env:ALL_CODE_OPENCODE_COMMAND = "C:\path\to\opencode.exe"
```

The equivalent variables for the other routes are `ALL_CODE_CLAUDE_COMMAND` and `ALL_CODE_CODEX_COMMAND`.

## The model list is empty

Run the agent's catalog command directly:

```bash
opencode models
```

For Codex, confirm that `codex app-server --stdio` starts. All Code stops Codex model discovery after 12 seconds and prints the catalog error.

## `403`, login required, or client restriction

Sign in through the selected CLI. Models tied to an OpenCode account or OpenCode's free service must run through the OpenCode route.

```text
› /agent opencode
```

## `429` rate limit

Choose another model or agent, or wait for the provider quota to reset:

```text
› /model
› /agent codex
```

## A model has no healthy deployment

The provider currently has no serving endpoint for that model. Select another entry from `/model`. Delegated tasks should use a model available to the target agent.

## Claude Code takes longer than its native terminal

All Code starts a new Claude Code print-mode process for each request, then resumes the saved native session. That startup is included in the time shown beneath the reply. Native Claude Code keeps its interactive process open, so a short reply there can feel faster. Installed hooks, plugins, and MCP servers may add to each launch. `allcode native --agent claude` opens Claude's own terminal interface if you need that behavior; it does not use All Code's shared workspace interface.

## Context did not follow an agent switch

Run `/status` and open the displayed `.allcode/session.json`. Shared messages apply to turns made through All Code; conversations created directly in another CLI are not imported.

## Start over

Exit All Code and remove `.allcode/` from the workspace. This resets the shared conversation and saved model choices. Native CLI authentication is unchanged.
