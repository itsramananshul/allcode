# Command reference

## Workspace

```text
allcode [--agent claude|opencode|codex] [--cwd PATH]
```

`--agent` selects the initial route. `--cwd` opens another working directory.

## Slash commands

| Command | Description |
| --- | --- |
| `/agent` | Open the agent picker |
| `/agent claude` | Switch to Claude Code |
| `/agent opencode` | Switch to OpenCode |
| `/agent codex` | Switch to Codex |
| `/provider` | Alias for `/agent` |
| `/model` | Open the model picker |
| `/model <id>` | Select a native model ID |
| `/models` | List models from all installed agents |
| `/status` | Print the active agent, model, session ID, and state file |
| `/clear` | Redraw the All Code workspace |
| `/help` | Print the command list |
| `/exit` | Exit; `/quit` is an alias |

Input that does not match an All Code command is sent to the active agent. This includes slash-prefixed input, so commands supported by an agent's non-interactive mode can still be used.

## Inspect agents

```bash
allcode agents
```

Prints the availability and resolved executable for Claude Code, OpenCode, and Codex.

## Inspect models

```bash
allcode models
allcode models claude
allcode models opencode
allcode models codex
```

## Run one task

```text
allcode run <agent> [--cwd PATH] [--model ID] [--session ID] <prompt>
```

Examples:

```bash
allcode run opencode --model opencode/big-pickle "find the failing test"
allcode run codex "review the current diff"
allcode run claude "explain the parser architecture"
```

The command prints the native session ID and final response as JSON.

## Native interface

```bash
allcode native --agent opencode
```

Native mode embeds the selected agent's own terminal interface. Use the default `allcode` command for the shared All Code interface and persisted cross-agent conversation.

## MCP server

```bash
allcode mcp
```

Starts the All Code MCP server over standard input and output. Agent adapters configure this automatically.

The server exposes:

- `list_agents`
- `start_task`
- `task_status`
- `list_tasks`
- `cancel_task`

## Environment

| Variable | Description |
| --- | --- |
| `ALL_CODE_ALLOWED_ROOTS` | Directories available to delegated tasks, separated by the operating system path delimiter |
| `ALL_CODE_MAX_DEPTH` | Maximum delegation depth; default `3` |
| `ALL_CODE_CLAUDE_COMMAND` | Absolute path to the Claude Code executable |
| `ALL_CODE_OPENCODE_COMMAND` | Absolute path to the OpenCode executable |
| `ALL_CODE_CODEX_COMMAND` | Absolute path to the Codex executable |

`ALL_CODE_DEPTH` and `ALL_CODE_HOST` are set internally for delegated processes.
