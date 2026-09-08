# Izuna

Claude Code を Codex のようにデスクトップから使う macOS アプリ。
`claude` CLI をヘッドレスで駆動し、会話・思考・ツール実行・差分・承認を GUI で描く。
想定利用者は作者ひとり。

- **何を作るか**: [docs/GOAL.md](docs/GOAL.md)（三本の柱と、やらないこと）
- **どう作るか**: [CLAUDE.md](CLAUDE.md)（入口）と `.claude/rules/*.md`（触るファイルに応じて読まれる）、[docs/DECISIONS.md](docs/DECISIONS.md)（背景）
- **Nimbalyst との違い**: [docs/NIMBALYST.md](docs/NIMBALYST.md)
- **CI（自宅 Forgejo Actions）**: [docs/ACTIONS.md](docs/ACTIONS.md)

## 動かす

```bash
pnpm install          # git hook と Electron 向けの再ビルドもここで
pnpm dev              # 開発。renderer は HMR、main は再起動が要る（CLAUDE.md §7）
pnpm verify           # 型検査と検査（カバレッジの線つき）。緑でなければ進まない
pnpm shots            # 実 renderer を作り物の window.izuna で撮る（§22）
pnpm e2e              # 本物の Electron を起動して口を叩く（§30）。要 build と Forgejo
pnpm build:mac        # .app を作る。署名も配布もしない
```

`claude` は PATH かログインシェルから探す。無ければ `~/.izuna/config.json` の
`claudePath` で指す（CLAUDE.md §15）。

## 守っていること

- 承認は人が持つ。ブレインにも自動にも渡さない
- 保存層を持たない。`~/.claude/projects/` が真実
- 信頼していないリポジトリの hook と `.mcp.json` は、開く前に止める
- Forgejo の鍵はボットのもの。平文で LAN を通る経路には送らない
- 本文は木で描き、HTML を作らない（例外は mermaid の 1 か所だけ）

詳しくは `.claude/rules/security.md`（§26）と `supply-chain.md`（§27）。
