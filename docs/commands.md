# Command reference

## Interactive workspace

| Command | Purpose |
| --- | --- |
| `allcode [--agent NAME] [--cwd PATH]` | Open the All Code interface. |
| `/agent [NAME]` | Select or switch the execution backend. `/provider` is an alias. |
| `/model [ID]` | Browse the active backend's catalog or select an exact model ID. |
| `/models` | Discover and display catalogs for all three backends. |
| `/status` | Show the active agent, model, native session ID, and shared context file. |
| `/clear` | Redraw the interface without deleting context. |
| `/help` | Show interactive commands. |
| `/exit` | Close All Code. `/quit` is an alias. |

Any other input is submitted to the selected agent. Unknown slash commands are forwarded too, but whether they behave like an interactive provider command depends on that CLI's non-interactive interface.

## Shell commands

```text
allcode agents
allcode models [claude|opencode|codex]
allcode run AGENT [--cwd PATH] [--model ID] [--session ID] PROMPT
allcode native [--agent AGENT] [--cwd PATH]
allcode mcp
```

`allcode native` is a compatibility mode that embeds the selected product's own terminal UI. The default `allcode` command uses All Code's stable monochrome interface.

`allcode mcp` speaks Model Context Protocol over standard input/output. It is intended to be launched by an MCP client, not used interactively.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `ALL_CODE_ALLOWED_ROOTS` | OS-path-delimiter-separated directories available to delegated tasks. |
| `ALL_CODE_MAX_DEPTH` | Maximum delegation nesting; defaults to `3`. |
| `ALL_CODE_DEPTH` | Internal current nesting depth. |
| `ALL_CODE_HOST` | Internal identifier for the currently hosting agent. |
| `ALL_CODE_CLAUDE_COMMAND` | Absolute Claude Code executable override. |
| `ALL_CODE_OPENCODE_COMMAND` | Absolute OpenCode executable override. |
| `ALL_CODE_CODEX_COMMAND` | Absolute Codex executable override. |

On Windows, separate allowed roots with `;`. On macOS and Linux, use `:`.
