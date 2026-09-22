# Contributing

Thanks for helping improve All Code.

## Development setup

```powershell
npm install
npm run check
node dist/cli.js agents
```

Use a supported Node.js release (22 or newer). Keep changes focused and include tests for routing, parsing, security boundaries, or platform-specific process behavior.

## Design rules

- Keep the All Code interface provider-neutral and monochrome.
- Use public, supported CLI surfaces; do not copy credentials or impersonate another client.
- Preserve native provider IDs instead of inventing universal model aliases.
- Do not bypass agent permission systems.
- Add a small adapter rather than scattering provider conditionals through the interface.
- Document behavior and limitations in the same change.

## Before opening a pull request

```powershell
npm run check
npm pack --dry-run
```

Describe the user-visible behavior, platforms tested, and any native CLI/version assumptions. Never commit `.allcode/`, credentials, generated logs, `node_modules/`, or the ignored `upstream/` reference clones.
