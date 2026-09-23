# Agents and models

## Agent routes

All Code has three routes:

| Route | Executable | Typical model ID |
| --- | --- | --- |
| `claude` | `claude` | `sonnet` |
| `opencode` | `opencode` | `opencode/big-pickle` |
| `codex` | `codex` | `default` |

`/agent` changes the route for the next request. The terminal layout and All Code commands remain the same.

Use `/agent` to choose from a searchable picker, or `/agent claude`, `/agent opencode`, or `/agent codex` to switch directly.

![All Code agent picker preview](images/agent-picker.svg)

## Model discovery

All Code uses live discovery for OpenCode and Codex, and supplies a short set of Claude Code aliases:

- OpenCode: `opencode models`
- Codex: app-server `model/list`
- Claude Code: `default`, `opus`, `sonnet`, `haiku`, and `fable`

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

Native session IDs are saved separately for Claude Code, OpenCode, and Codex. Returning to an agent resumes that agent's session when the CLI supplies a resumable ID.

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
