# Running Izuna on your Mac

> Izuna is a tool for **people who run their own Forgejo** (docs/GOAL.md). If you have no Forgejo,
> it is not for you. This document is the setup path on a Mac that is not the author's.
> The app's setup screen checks every step for you. **It changes nothing until you press a button.**

## What you need

| What | Why | If missing (the setup screen says this) |
| --- | --- | --- |
| macOS (Apple Silicon; Intel builds are not published) | The Electron build is macOS only | — |
| **Claude Code** (`claude` CLI), logged in | Izuna runs your local `claude` as a child process. It never uses an API key (CLAUDE.md §14) | `curl -fsSL https://claude.ai/install.sh \| bash` then `claude auth login` |
| **Forgejo**, your own | The sandbox. Executors' work becomes pull requests here first | One of the three layouts below |
| `gh` CLI, logged in | Issues and pull requests on the upstream (GitHub) are handled by `gh` | `brew install gh` then `gh auth login` |
| `git` | — | Xcode Command Line Tools |

## Install

```bash
brew tap watakumi/izuna
brew trust watakumi/izuna      # Homebrew 6 refuses third-party taps until you trust them
brew install --cask izuna
```

The tap is https://github.com/Watakumi/homebrew-izuna (`Casks/izuna.rb`: just the version and the DMG's
sha256). The cask puts `/Applications/Izuna.app` in place and prints the opening instructions below as
caveats (`brew info --cask izuna`). To install by hand, download the DMG from
[Releases](https://github.com/Watakumi/izuna/releases).

## Opening the app (while it is unsigned)

The build is not signed with an Apple certificate. A person has to provide one; with the certificate and
Apple ID in the repository secrets, `.github/workflows/release.yml` signs and notarizes. Until then macOS
says "cannot verify the developer".

| macOS | How to open |
| --- | --- |
| up to 14 | Right-click the app in Finder, choose Open |
| 15 and later | Try to open it once and get refused, then System Settings → Privacy & Security → "Open Anyway" at the bottom. From a terminal: `xattr -dr com.apple.quarantine /Applications/Izuna.app` |

electron-builder applies an ad-hoc signature, so macOS does not call the app "damaged".

## Three ways to run Forgejo

### 1. Homebrew on this Mac (what the author does)

The setup screen does all of it: "Install with Homebrew" → "Start" → finish the initial setup in the
browser → "Issue a token". Creating the bot user `izuna` and issuing its token go through the `forgejo`
CLI, so these buttons exist only in this layout, where the binary is on this Mac.

### 2. Docker on this Mac

Write `~/.izuna/config.json`:

```jsonc
{
  "forgejoWorkPaths": [],
  "forgejoUrl": "http://localhost:3000/"
}
```

There is no `forgejo` CLI on this Mac, so the bot and its token are created **through the Forgejo API**.
Two ways:

**a. From the setup screen (recommended).** Enter the Forgejo admin's name and password and press
"Create the bot and its token". Izuna uses the admin's Basic auth for `POST /admin/users` (the bot
`izuna`; skipped if it already exists) and `POST /users/izuna/tokens` (`write:user`, `write:repository`),
then stores the returned token through the same gate as a pasted one (does it work, does it belong to
`izuna`). **The password is not stored.** It rides on those two requests and is discarded: never written
to disk, never logged, never shown in an error. It is only sent over loopback or https. If the admin has
two-factor authentication this returns 403; use b instead. That an admin can issue another user's token
was measured on Forgejo 16.0.3 (2026-09-11: with a throwaway admin, `POST /admin/users` returned 201, a
second call 422 "user already exists", `POST /users/<bot>/tokens` returned 201 with a 40-character `sha1`,
and `GET /user` with that token answered as the bot; both accounts were deleted afterwards).

**b. By hand in Forgejo.**

1. Create a user named `izuna` in Forgejo (it does not need to be an admin).
2. Log in as `izuna`, go to Settings → Applications → Access tokens, and create one with `write:user` and
   `write:repository` (add `write:issue` if you want comments on pull requests).
3. Paste it into the setup screen's "paste the izuna token" field and press "Store".

Either way, Izuna asks Forgejo whether the token **works and belongs to `izuna`** before storing it.
A person's (admin's) token is refused: the app never holds a human's key (CLAUDE.md §26).

### 3. Forgejo on another machine

Same as 2, but **the URL must be https**. Izuna does not send the token over plain http on a network
(the "transport" row of the setup screen turns red). This applies on a home LAN too.

## What the setup screen shows when everything is ready

Work down the list. Optional rows (Actions, runner) do not count.

```
Claude Code   ✓ 2.1.266 · ~/.local/bin/claude
Login         ✓ claude.ai · max
Forgejo
Install       ✓ 16.0.4 · /opt/homebrew/bin/forgejo      (with Docker: "uses forgejoUrl from the config")
Setup         ✓ http://localhost:4649/ · …/app.ini
Running       ✓ responded
Token         ✓ write:user, write:repository
```

The screen itself is in Japanese (the app's interface language).

## Where the settings live

`~/.izuna/config.json`. It is optional. The format is in `.claude/rules/config.md` (§15).

```jsonc
{
  "forgejoWorkPaths": ["/opt/homebrew/var/forgejo"], // [] with Docker
  "forgejoUrl": null, // when app.ini cannot be read
  "sandboxRemote": "forgejo", // name of the sandbox remote
  "repoRoots": ["~/work", "~/src"], // where repositories are searched for
  "claudePath": null, // when claude is not on PATH
  "trustedRepos": [] // repositories opened without asking even if they contain hooks
}
```

## Running from source

```bash
brew install gitleaks     # pre-push gate. Without it you cannot push (the secret scan is a gate)
pnpm install
pnpm dev
pnpm verify               # fails if your claude version differs from the measured one. IZUNA_CI=1 skips that, as in CI
```

## CI on your own Forgejo Actions (optional)

docs/ACTIONS.md (in Japanese). The runner runs in Docker and needs `docker.sock`, which is a decision a
person makes. `HTTP_ADDR` can stay `127.0.0.1`.
