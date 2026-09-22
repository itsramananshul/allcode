# Getting started

## Requirements

- Node.js 22 or newer
- npm
- Claude Code, OpenCode, or Codex installed locally
- A valid login or provider configuration for every CLI you plan to use

All Code uses the installed executables. It does not include models, accounts, subscriptions, or provider credits.

## Install from source

```powershell
git clone https://github.com/itsramananshul/all-code.git
cd all-code
npm install
npm run check
npm link
```

`npm link` installs the `allcode` command from your checkout. Run `npm unlink -g all-code` to remove that link later.

## Verify agent availability

```powershell
allcode agents
```

The JSON output reports the resolved path or a useful error for Claude Code, OpenCode, and Codex. To override a launcher path, set one of:

```text
ALL_CODE_CLAUDE_COMMAND
ALL_CODE_OPENCODE_COMMAND
ALL_CODE_CODEX_COMMAND
```

## Start a workspace

Run `allcode` from the project you want the agents to edit:

```powershell
cd C:\path\to\your\project
allcode
```

All Code creates `.all-code/session.json` in that project. Add `.all-code/` to the project's ignore file if it is not already ignored.

To force the initial route:

```powershell
allcode --agent claude
allcode --agent opencode
allcode --agent codex
```

Without `--agent`, All Code restores the saved active agent when a session exists and otherwise starts with OpenCode.

## Authentication

Authenticate each CLI using its official flow before selecting it in All Code. All Code neither reads nor translates subscription credentials. This separation is important: an OpenCode model can be used only through an OpenCode provider route that your OpenCode installation is allowed to access.
