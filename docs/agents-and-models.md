# Agents and models

## Agent routes

All Code includes four routes and can register additional installed agents:

| Route | Executable | Typical model ID |
| --- | --- | --- |
| `claude` | `claude` | `sonnet` |
| `opencode` | `opencode` | `opencode/big-pickle` |
| `codex` | `codex` | `default` |
| `hermes` | `hermes` | `default` or a provider-prefixed model ID |

`/agent` changes the route for the next request. The terminal layout and All Code commands remain the same.

Use `/agent` to choose from a searchable picker, or `/agent claude`, `/agent opencode`, `/agent codex`, or `/agent hermes` to switch directly.

![All Code agent picker preview](images/agent-picker.svg)

## Model discovery

All Code uses live discovery for OpenCode, Codex, and Hermes, and supplies a short set of Claude Code aliases:

- OpenCode: `opencode models`
- Codex: app-server `model/list`
- Claude Code: `default`, `opus`, `sonnet`, `haiku`, and `fable`
- Hermes: ACP `session/new` model catalog from your installed Hermes CLI

Run discovery without opening the workspace:

```bash
allcode models
```

The selected model ID is passed unchanged to its agent. Provider names, free-tier routes, Go models, local providers, and account restrictions are interpreted by that agent.

## Model selection

Open the picker:

```text
› /model
```

![All Code model picker preview](images/model-picker.svg)

The highlighted model is selected with Enter or Tab. Type to filter the list, or use `/models` to browse all installed agents in one picker. Choosing a model from another agent also switches the active route.

Select an exact ID:

```text
› /model opencode-go/deepseek-v4.1-flash
```

Each agent keeps its own selection. Moving from OpenCode to Codex and back restores the OpenCode model.

`/effort` shows the reasoning levels available for the active model. The selected level is stored per agent; changing that agent's model resets its effort to the provider default.

## Context handoff

All Code records each turn in `.allcode/session.json`. A delivery cursor tracks which messages each agent has seen. On the first request after a switch, the new agent receives the unseen conversation followed by the current request.

Native session IDs are saved separately for Claude Code, OpenCode, Codex, and Hermes. Returning to an agent resumes that agent's session when the CLI supplies a resumable ID.

Hermes runs through `hermes acp` in the shared workspace. Its ACP session supports model and permission-mode changes without replacing your installed Hermes configuration. `allcode native --agent hermes` instead opens Hermes's own terminal UI.

## Delegation

The active agent receives the All Code MCP server. It can start a task in another agent and collect the result without changing the active route.

```text
Claude Code
    └── start_task(agent: "codex", prompt: "review the current diff")
            └── Codex runs in the same workspace
                    └── result returns to Claude Code
```

Delegated agents use their own model selection, authentication, tools, and permissions. `ALL_CODE_MAX_DEPTH` limits nested delegation.

## Provider errors

Authentication failures, account restrictions, unavailable deployments, and rate limits come from the selected provider. Use `/model` to choose another available model or `/agent` to change routes.

## Adding agents and skills

`/add` opens a picker for Agent or Skill. For an agent, All Code scans the current terminal's PATH for known coding-agent commands and offers the ones it finds. Select a new agent to have the active agent inspect its CLI and write an adapter draft. Use **Find by command name** if a CLI is installed on PATH but not listed. **Advanced manual setup** remains available for ACP and one-shot routes. The scan reads launcher files; it does not execute every candidate, search the entire disk, install software, or prove that a CLI is authenticated. All Code uses the bundled [adapter-authoring skill](../skills/allcode-agent-adapter/SKILL.md) as its instructions. The draft goes in `<workspace>/.allcode/adapter-drafts/<name>`; review `adapter.json` and `agent.mjs` before confirming installation. The installed copy goes in `~/.allcode/adapters/<name>`, with its registration in `~/.allcode/agents.json`. Neither location is part of the npm package, so package updates leave custom adapters and their configuration in place. Adapter JavaScript runs with your user account's permissions.

You can also register an ACP server or a one-shot CLI directly. ACP agents are contacted over their server for model discovery, native session IDs, and permission requests. One-shot agents run once per turn and return stdout as their reply. All Code passes the shared transcript on an agent switch, but it cannot invent native sessions or approval prompts for a CLI that lacks them. A custom adapter can expose more capabilities when the underlying CLI offers them; unsupported capabilities remain unavailable.

The one-shot command receives its prompt on stdin by default. If an argument contains `{prompt}`, the prompt is inserted there instead; `{model}` inserts the selected model ID. Avoid `{prompt}` if prompts may contain secrets, because command-line arguments can be visible to other processes. An ACP registration should use the arguments that start that CLI's ACP server. `/add` does not install or authenticate the CLI.

For skills, All Code copies a reviewed `SKILL.md` folder to the skill locations used by installed built-in agents:

| Agent | Skill location |
| --- | --- |
| Claude Code | `~/.claude/skills/<name>` |
| Codex and OpenCode | `~/.agents/skills/<name>` (one shared copy) |
| Hermes | `${HERMES_HOME:-~/.hermes}/skills/<name>` |

Custom agents can declare additional absolute `skillsDirs` in their adapter manifest. All Code includes those destinations when installing a skill; it does not assume every CLI supports `SKILL.md`. This covers shared `SKILL.md` skills, not proprietary tool or plugin formats. Review a skill's instructions and scripts before installing it; All Code does not execute them during installation, but an agent may use them later. If a target name already exists, All Code skips it and reports the conflict.
