# Troubleshooting

## `allcode` is not recognized

Build and link the checkout:

```powershell
npm install
npm run build
npm link
```

Then open a new terminal and run `allcode agents`.

## An agent is unavailable

Run `allcode agents`. If the CLI is installed somewhere unusual, set its `ALL_CODE_*_COMMAND` variable to the absolute executable path. On Windows, point to a real executable rather than a `.cmd` wrapper when possible.

## Model discovery fails

Run the native command first:

```powershell
opencode models
codex app-server --stdio
```

All Code reports a catalog error instead of hanging when a process exits or the 12-second discovery timeout is reached. Catalog failure does not remove already saved model IDs.

## `403` or “run /login”

Authenticate the selected native CLI. If the message says a free route can only be used from a particular client, select that client with `/agent`; credentials from another product cannot authorize it.

## `429` rate limit

The provider rejected the request. Wait, choose a different model available to the same CLI, or switch agents. Retrying rapidly usually extends the disruption and does not create quota.

## Context did not appear after switching

Use `/status` and inspect the reported `.allcode/session.json`. All Code sends unseen All Code turns across agents; it cannot import private historical conversations created outside this workspace.

## Reset local context

Exit All Code, back up `.allcode/session.json` if needed, then delete the `.allcode` directory in that project. This starts a fresh All Code session and does not sign out any native CLI.
