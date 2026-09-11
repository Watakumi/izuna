# Security

Izuna runs your local `claude` CLI as a child process and writes to Forgejo and GitHub.
What it protects and how is in `.claude/rules/security.md` (§26, in Japanese); the dependency
policy is in `supply-chain.md` (§27).

## Reporting

If you find a vulnerability, **do not open a public issue.** Report it privately through GitHub's
[Security Advisories](https://github.com/Watakumi/izuna/security/advisories/new). These help:

- Steps to reproduce (which repository was opened, which action was taken)
- Impact (what can be read, written, or executed)
- Environment (macOS version, `claude --version`, Forgejo version and how it is deployed)

## Response

- You will hear back within 7 days.
- Fixes are noted in the Release notes, with credit to the reporter if wanted.
- Please keep the report private until a fix is released.

## Scope

- Izuna's code (main / preload / renderer / scripts)
- How the distributable (DMG) is built and configured (`electron-builder.yml`, `build/fuses.mjs`)

Out of scope: Claude Code itself, Forgejo itself, and third-party packages. Report those upstream.
