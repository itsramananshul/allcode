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

The equivalent variables for the other routes are `ALL_CODE_CLAUDE_COMMAND`, `ALL_CODE_CODEX_COMMAND`, and `ALL_CODE_HERMES_COMMAND`.

## The model list is empty

Run the agent's catalog command directly:

```bash
opencode models
```

For Codex, confirm that `codex app-server --stdio` starts. All Code stops Codex model discovery after 12 seconds and prints the catalog error.

For Hermes, run `hermes acp --check`. All Code reads the available models from a Hermes ACP session; the first discovery can take time while Hermes loads its configuration and tools.

## Hermes reports an unsupported default model

The default model belongs to your Hermes provider configuration, not All Code. Run `allcode models hermes`, then select an available provider-prefixed model with `/model` or `allcode run hermes --model <id>`. This changes the All Code session selection without editing your Hermes settings.

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

Interactive All Code keeps one Claude Code streaming process open across turns. It starts when you open a Claude workspace or switch to Claude, so the next request can reuse it. The first request may still wait while Claude connects your MCP servers and permission tool; changing Claude's model, effort, or permission mode also restarts that process. Later requests with unchanged settings avoid this startup. One-shot `allcode run claude` and background delegated tasks still start separate processes.

## Context did not follow an agent switch

Run `/status` and open the displayed `.allcode/session.json`. Shared messages apply to turns made through All Code; conversations created directly in another CLI are not imported.

## Start over

Exit All Code and remove `.allcode/` from the workspace. This resets the shared conversation and saved model choices. Native CLI authentication is unchanged.
