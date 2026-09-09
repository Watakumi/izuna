---
paths:
  - "package.json"
  - "pnpm-workspace.yaml"
  - "pnpm-lock.yaml"
  - ".npmrc"
  - ".forgejo/**"
  - "electron-builder.yml"
  - "build/**"
  - "src/main/exec.ts"
  - "src/preload/**"
  - "src/shared/ipc.ts"
  - "src/main/claude/locate.ts"
---

# 重複の整理とサプライチェーン

外の道具の包み、preload の生成、IPC の版、依存の入口（release age、固定、CI の固定）、registry。

## 27. 重複の整理とサプライチェーン（2026-09-08）

§26 のあと、実装の重複と依存の入口を数えて直した。

### 直したもの

| 何が | 数えた結果 | どうした |
| --- | --- | --- |
| 外の道具を呼ぶ包みが 5 ファイルにあった | `promisify(execFile)` が locate / setup / github / remote / worktree | `src/main/exec.ts` の `run()` に寄せた。`test/surface.test.ts` が増えないことを見張る |
| `loginShellEnv()` が呼ばれるたびに `.zshrc` を評価していた | 8 か所から、1 回 0.13 秒 | 一度取ったら覚える。セッション起動時に `refreshLoginShellEnv()` で取り直す |
| preload の口が手書きで、型・preload・harness の 3 表を揃えていた | 使われていない口が 9 つ | `CH` の鍵から組む。`IzunaApi` にあって `CH` に無い名前は型検査で落ちる |
| `IPC_VERSION` を手で上げていた | 「上げ忘れても害はない」と書いてあった | `CH` の鍵から導く。口が増減すれば必ず変わる |
| mermaid を先頭で `import` していた | 展開 83MB、本体だけで 1MB 超 | 図が出たときに `import()` する |
| `.mcp.json` を開いただけで読んでいた | SDK は `strictMcpConfig` を付けない限り読む（`sdk.d.ts` で確認） | hook と同じ関所を通す（`command` のあるサーバを数える） |
| `tsconfig.*.tsbuildinfo` が版管理に入っていた | 絶対パスを含む | 外して `.gitignore` に足した |

### サプライチェーン

**入口の締め方は前からできていた。** CI は `--frozen-lockfile`、`allowBuilds` で
postinstall を electron / esbuild / node-pty に限定、更新機構は無い。足りなかったのは次の 4 つ。

- **`minimumReleaseAge` が無かった。** `minimumReleaseAgeExclude` の一覧だけがあり、
  本体の値が無かった。除外リストがあるので効いていると読めるが、効いていなかった。
  `1440`（24 時間）を明示した。SDK の platform バイナリは版が CLI と連動するので除外のまま
- **mermaid は exact で固定する。** アプリで唯一の HTML 注入口で、消毒を丸ごと mermaid に
  委ねている。caret で黙って上がる依存にしておかない。上げるときは changelog と `pnpm audit` を見てから手で上げる
- **道具の版を書く。** `packageManager: pnpm@11.22.0`、`engines.node >= 24`、`.node-version`（mise が読む）。
  それまで CI の `corepack prepare` だけが固定していた
- **CI の固定。** `actions/checkout` はコミット、`node:24` はダイジェスト。
  `pnpm audit` を `continue-on-error` で足した —— 直せないもの（§26 の extract-zip）があるので門にはしない。
  **runner で動くかは未確認**（Forgejo への push が §7 の 401→404 で通らなかった）

### registry（2026-09-09 に見直した）

以前 `.npmrc` の registry が `https://npm.flatt.tech/` を向いていると書いたが、**いまの `.npmrc` は
`shamefully-hoist=true` だけ**で、registry は既定（npmjs）である。配るリポジトリなので、
貢献者の環境で別の registry を向かせない。

### GitHub 側の CI（2026-09-09）

配るので `.github/workflows/` に 3 本置いた。`verify.yml`（型と検査）、`security.yml`（gitleaks・osv-scanner・
electronegativity。週 1 回も回して新しい advisory を拾う）、`release.yml`（タグ `v*` で macOS の DMG を組んで
Release に付ける）。action は全部コミットで固定。自宅の Forgejo の分（`.forgejo/workflows/`）はそのまま。

### 不透明なもの

- `ghostty-web` は `ghostty-vt.wasm`（2.1MB）を同梱している。ソースから作ったものかを確かめる手段が無い
- `node-pty` は `allowBuilds` でソースからビルドされる
- Electron 本体は `@electron/get` が SHASUMS で検証する

### やっていないこと

- （`register.ts` の駆動部と renderer の単体検査は §28 でやった）
- lint。エラー 28、警告 1590 で `verify` に入っていない。prettier を守るか外すかは書き手が決めること
- 握りつぶした例外 57 か所の仕分け
- 使われていない 9 つの口（`listWakeups` ほか。起床の予約は UI がまるごと無い）
