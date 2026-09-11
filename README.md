# Izuna

A macOS app for using Claude Code together with your own Forgejo.
It drives the `claude` CLI headlessly and draws the conversation, thinking, tool calls, diffs, and
approvals in a GUI. It is a tool for **people who run their own Forgejo**: the executors' messy work
becomes pull requests on your Forgejo (the sandbox), you review them there, and only finished work
goes to GitHub (the upstream). Approvals stay with a person.

日本語の README は [README.ja.md](README.ja.md)。

## The name

*Izuna* (飯綱, also 管狐 *kuda-gitsune*) is a fox-like spirit animal in Japanese folklore. An
*izuna-tsukai* commands these spirits to work for them; the practice appears in medieval Shugendō
and in ninjutsu lore. The app is named after that image: you command Claude's agents, and they work
for you. The icon is the spirit's face, drawn as one shape.

## Install

```bash
brew tap watakumi/izuna
brew trust watakumi/izuna      # Homebrew 6 refuses third-party taps until you trust them
brew install --cask izuna
```

Apple Silicon only. The tap is [Watakumi/homebrew-izuna](https://github.com/Watakumi/homebrew-izuna).
You can also download the DMG from [Releases](https://github.com/Watakumi/izuna/releases).
The app is **not signed** with an Apple certificate, so macOS blocks it the first time; how to open
it is in [docs/SETUP.md](docs/SETUP.md).

## What you need

- **Claude Code** (`claude`), logged in. Izuna runs your local `claude` as a child process and never
  uses an API key.
- **Your own Forgejo.** Homebrew on this Mac, Docker, or another machine over https.
- **`gh`**, logged in, for GitHub issues and pull requests.

The setup screen in the app checks all of this and tells you what is missing. Details:
[docs/SETUP.md](docs/SETUP.md).

![Conversation, approval bar, and the right panel. Rendered from a synthetic window.izuna by the
screenshot harness, captured 2026-09-10.](docs/readme/conversation.png)

The screenshot is drawn from recorded fixtures (`pnpm shots`), not from a live API call. The capture
date is written down so that an outdated picture is noticed when the screen changes.

## Documents

Documents that face outward (this README, `docs/SETUP.md`, `SECURITY.md`) are in English. Documents
that face inward, for the author and for the agents that work on this repository, are in Japanese:

- **What it builds**: [docs/GOAL.md](docs/GOAL.md) (the three pillars, and what it will not do)
- **How it is built**: [CLAUDE.md](CLAUDE.md) (the entry point), `.claude/rules/*.md` (loaded by the
  files you touch), [docs/DECISIONS.md](docs/DECISIONS.md) (background)
- **Compared with other tools**: [docs/NIMBALYST.md](docs/NIMBALYST.md), [docs/ORCA.md](docs/ORCA.md)
- **CI on your own Forgejo Actions**: [docs/ACTIONS.md](docs/ACTIONS.md)

## Developing

```bash
brew install gitleaks # pre-push gate (secret scan). Without it you cannot push
pnpm install          # also installs git hooks and rebuilds native modules for Electron
pnpm dev              # renderer hot-reloads; the main process needs a restart (CLAUDE.md §7)
pnpm verify           # typecheck, lint, tests with coverage floors. Nothing merges unless green
pnpm run catchup      # after claude updates: align the SDK, re-record fixtures, bump the measured version
pnpm shots            # render the real renderer against a synthetic window.izuna and screenshot it (§22)
pnpm e2e              # launch the real Electron app and call every IPC endpoint (§30). Needs a build and Forgejo
pnpm walk             # walk the seven v1 steps against real services (§31). Writes to GitHub and Forgejo
pnpm build:mac        # build the DMG. Signing and notarization only run when a certificate is present
```

`claude` is found on PATH or through your login shell. If it lives elsewhere, set `claudePath` in
`~/.izuna/config.json` (CLAUDE.md §15).

## What it keeps

- Approvals stay with a person. Never delegated to the orchestrating agent or automated.
- No storage layer. `~/.claude/projects/` is the source of truth.
- Hooks and `.mcp.json` in an untrusted repository are stopped before the repository is opened.
- The Forgejo token belongs to a bot, never to a person, and never travels over plain http on a LAN.
- Markdown is rendered as a tree, never as HTML (the single exception is mermaid).
- Embedded pages (PR previews) are limited to Forgejo and GitHub, with Node disabled and a sandbox.
- gitleaks scans for secrets before every push and in CI; osv-scanner watches dependencies.

Details: `.claude/rules/security.md` (§26) and `supply-chain.md` (§27).
