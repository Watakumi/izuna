# Izuna

Claude Code を自分の Forgejo と一緒にデスクトップから使う macOS アプリ。

このファイルは**入口**である。会話履歴を持たないエージェントがこれを読み、
触るファイルに応じて `.claude/rules/*.md` が足される（`paths` で決まる。2026-09-08 に分けた。
それまで 2,191 行を毎セッション全部読んでいた）。事実と、その根拠になった実測を残す。
推測は「未検証」と明記する。**節番号（§N）は分けても変えていない**。コードの註から引ける。

- リポジトリ: `~/work/personal/izuna` / upstream は https://github.com/Watakumi/izuna （2026-09-09 に履歴を書き換えて作り直し、**public** にした・§20）
- **何を作るかは [docs/GOAL.md](docs/GOAL.md)。** このファイルは*どう*作るかを書く
- 他人の環境で動かすには [docs/SETUP.md](docs/SETUP.md)（Claude Code、Forgejo の 3 つの置き方、gh）
- Nimbalyst と何が違い、何を取り何を取らないかは [docs/NIMBALYST.md](docs/NIMBALYST.md)（2026-09-08）
- Orca と何が違い、何を取り何を取らないかは [docs/ORCA.md](docs/ORCA.md)（2026-09-11。5 つの観点）
- 設計の決定: https://claude.ai/code/artifact/873094d6-cdf6-46b4-b488-a69ab9e3641e （元は `design/`）
  **画面そのものは描かない。実装が正。** 理由は §16
- 現状: **MVP は完了**（会話・パレット・承認・差分・worktree・Forge・ターミナル・
  セッションの一覧と resume・画像・mermaid・盤面・自律ループ）。
  2026-09-08 にセキュリティ（§26）・重複と依存（§27）・検査の範囲（§28）を見直し、
  `docs/NIMBALYST.md` §3 の 7 件を入れた。2026-09-09 に features ページの 3 件（§7）、
  `pnpm e2e`（§30）、**v1 の 7 手の通し**（`pnpm walk`。§31、`docs/v1-walk/`）を入れた。
  Actions の状態を読む口・実行役の節目・GitHub への漏れの判定も同日。
  次は runner を回すかの判断（docs/ACTIONS.md）と、`docs/NIMBALYST.md` §7 の保留 2 件
- **`pnpm verify` は緑**（1,090件）。壊したら直してから進むこと
- **失敗の記録は [.claude/agent-mistakes.md](.claude/agent-mistakes.md)。作業を始める前に読む**
- 最終更新の根拠となった CLI: `claude 2.1.266`（2026-09-10 に 2.1.263 から上げ、fixture を録り直した）/ macOS 26.4.1 / Node 24.15 / pnpm 11.22

---

---

## 1. 何を作るか

`claude` CLI を**ヘッドレスで駆動**し、会話・思考・ツール実行・差分・承認を
GUI で描くデスクトップアプリ。ターミナルの中で TUI を動かすのではなく、
アプリが CLI をプロトコル越しに操作する。

**差別化の核は `/` コマンド。** 実行するだけでなく、横断的に見て・探して・
編集できるようにする。**「既存 GUI は実行しかできない」は古い** —— Nimbalyst は
出どころと本文を見せ、元の `.md` を開ける（`docs/NIMBALYST.md` §5）。
差にするなら、複数リポジトリを跨ぐ検索や実行履歴との突き合わせまで要る。

想定利用者は作者ひとり。汎用製品として競合に勝つことは目標にしない（§2）。

---

## 先に読む規則

一度ゆるめると気づけないもの。根拠は各節にある。

1. **承認は人が持つ。** ブレインにも自動にも渡さない（docs/GOAL.md 完成の定義 5、§6）。
   答えが無ければ 5 分で deny。
2. **保存層を持たない。** `~/.claude/projects/` が真実で、複製すると食い違う（§18）。
3. **本文は木で描き、HTML を作らない。** 例外は `Mermaid.tsx` の 1 か所だけで、
   `test/surface.test.ts` が増えないことを見張る（§25、§26）。
4. **信頼していないリポジトリの hook と `.mcp.json` は、開く前に止める**（§26）。
   信頼は `~/.izuna/config.json` の `trustedRepos` に書く。
5. **鍵は人のものを持たない。** Forgejo はボット `izuna` のトークン。平文で LAN を通る
   経路には送らない。URL にも引数にも埋めない（§26、§7）。
6. **外の道具は `src/main/exec.ts` の `run()` から呼ぶ。** シェルを通さない。
   stderr を捨てない（§27）。
7. **口を足したら `shared/ipc.ts` の `CH` に書く。** preload と `IPC_VERSION` はそこから導かれる。
   手で並べない、手で上げない（§27）。
8. **文書に書いたものは動いていなければならない。** 書いたのに呼ばれていないものは
   `test/docs.test.ts` が落とす。動かさないなら書くのをやめる（§24）。
9. **`pnpm verify` が緑でなければ完了としない。** カバレッジの線は下げない。
   上げるなら検査を足してから（§10）。
10. **判断は測ってから。数値には日付を付ける。** 推測で上書きしない。「未検証」と書く。

---

## 4. リポジトリ構成

```
src/main/claude/session.ts  SDK の query() で claude を飼うセッション層。UI を知らない
src/main/claude/locate.ts   claude 本体とログインシェル環境の解決（環境は一度取ったら覚える。§27）
src/main/claude/status.ts   claude が入っているか・ログイン済みか（docs/SETUP.md）。email は出さない
src/main/claude/trust.ts    開く前の関所。hook と .mcp.json を数え、信頼していなければ止める（§26）
src/main/hub.ts             セッションの駆動部。1 件 1 record（session・共有フォルダ・cwd・ループ）。§28
src/main/ipc/register.ts    口を関数に繋ぐ表だけ。Handlers の型が口の数だけ手があることを見る
src/main/exec.ts            外の道具（git / gh / forgejo / brew）を呼ぶ唯一の包み（§27）
src/main/team.ts            共有フォルダと盤面（作る・読む・log.md を書く）
src/main/terminal.ts        PTY を持つだけ。バイト列を解釈も加工もしない
src/main/loop.ts            自律ループの駆動と、進捗を申告する MCP ツール（§23）
src/main/wakeup.ts          起床の予約。覚えのある id だけ起こす（§26）
src/main/preview.ts         頁を窓の中に埋める WebContentsView を 1 枚持つ（§32）
src/main/protocol.ts        renderer を app:// で配る。出力ディレクトリの外は 404（§26）
src/main/sessions.ts        ~/.claude/projects の走査と復元（§18）
src/main/forge/, git/       Forgejo の API と準備、git の remote / worktree
src/preload/index.ts        renderer に出す面。CH の鍵から組む。手で並べない（§27）
src/shared/ipc.ts           口の型と名前（CH）。IPC_VERSION は鍵から導く
src/shared/hooks.ts         リポジトリが持ち込む hook / MCP の検出（純粋関数）
src/shared/links.ts         外に出してよいリンクと、中で見てよい頁の判定（純粋関数）
src/shared/prereq.ts        Claude Code の関所の判定（純粋関数）
src/shared/app-protocol.ts  app:// の URL → 出力ディレクトリの中のパス（純粋関数）
src/shared/team.ts          札・要約・決定・記録のパース、重なりの判定（純粋関数）
src/shared/sessions.ts      要約・見出し・絞り込み・復元（純粋関数）
src/shared/transcript.ts    会話の状態モデル。SDKMessage を畳んで積む
src/shared/teammate.ts      実行役の節目（SubagentStart / Stop …）を hook から読む（純粋関数。§12）
src/shared/ci.ts            Forgejo Actions の実行を ok / ng / running / none に畳む（純粋関数）
src/shared/markdown.ts      本文の解釈。木を返して HTML を作らない（例外は Mermaid.tsx だけ）
src/renderer/src/App.tsx    画面。右パネルに 情報 / ファイル / 盤面 / ループ / PR / ブランチ

scripts/protocol.ts         stream-json のワイヤ型。**アプリは使わない**（下記）
scripts/record-fixture.ts   実セッションの NDJSON を fixture として録る。実 API を呼ぶ
scripts/smoke-session.ts    人が目で見る疎通確認。実 API を呼ぶ
scripts/smoke-permission.ts 権限承認の握手が成立するかを見る。実 API を呼ぶ
scripts/shots.ts            実 renderer を作り物の window.izuna で撮る（§22）
scripts/e2e.ts              本物の Electron を起動して口を叩く（§30）。起動は scripts/lib/electron.ts
scripts/walk.ts             v1 の 7 手を本物で通し、docs/v1-walk/ に撮る（§31）。実 API を呼ぶ
scripts/probe-team.ts       実行役 2 つを並走させて hook と worktree を測る（§12）。実 API を呼ぶ
scripts/catchup.mjs         claude が上がったら SDK・fixture・版を揃える（pnpm run catchup。§10）

test/docs.test.ts           **文書と実装のズレの門**（§24）
test/surface.test.ts        renderer に出す面・HTML の注入口・execFile の呼び手の門（§26–27）
test/main-hub.test.ts       駆動部の検査。ループと予約は本物を回す（§28）
test/renderer/              部品を jsdom で描く検査（§28）
test/scripts-protocol.test.ts 録画に対する門。網も費用も要らない
test/auth.test.ts           認証経路（Pro プランか API キーか）と SDK/CLI の版の門
test/fixtures/session-safe.ndjson  --safe-mode で録った記録。**版管理に入る**。門はこれを見る
test/fixtures/session-full.ndjson  素で録った記録。**gitignore**（§11）。手元専用
CLAUDE.md                   このファイル
```

**設計原則**: `ClaudeSession` は UI を知らない。パースはプロセスを知らない。
この 2 段があるので、UI を壊さずに下の層を検証でき、
かつ下の層の検証に実 API が要らない。

**`scripts/protocol.ts` が `src/` に無い理由。** これは
`--output-format stream-json` のワイヤ型で、CLI を直接叩いていた頃の資産である。
いまアプリは SDK の `query()` から型付きの値を受け取るので、**製品コードは触らない**。
使うのは録画の道具と、録画に対する門だけ。`src/` に置いたままだと
「アプリが使っている」ように見え、上流が変わったとき壊れる範囲を読み違える。
置き場所そのものが、誰が依存しているかの申告である。

---

## 8. スコープ

### MVP でやる

- [x] stream-json 双方向セッション（`ClaudeSession`）
- [x] 会話ビュー: text / thinking / tool_use / tool_result の逐次描画
- [x] **`/` パレット**（差別化の本体）: `supportedCommands()` + あいまい検索・引数ヒント
- [x] 権限承認 UI（§6）
- [x] 差分ビュー（ツール入力から生成）。**1 件ずつの accept/reject は未実装**
- [x] **セッション resume と履歴**（§18）

### やらない（当面）

ターミナルペイン、libghostty、worktree 並列、PR 連携、モバイル、
Windows / Linux、複数エージェント対応。

---

## 規則の置き場

触るファイルに応じて読まれる。**全部を一度に読まない。** 節番号は分ける前のまま。

| ファイル | 内容 | 節 |
| --- | --- | --- |
| `.claude/rules/claude-cli.md` | claude の駆動 | §5, §6, §13, §14 |
| `.claude/rules/pitfalls.md` | 実装上の罠 | §7 |
| `.claude/rules/testing.md` | 検査 | §10, §11, §24, §28, §30, §31 |
| `.claude/rules/team.md` | ブレインと実行役 | §12 |
| `.claude/rules/config.md` | 設定 | §15 |
| `.claude/rules/ui.md` | 画面 | §16, §17, §17.4, §17.5, §21, §22, §25, §29, §32 |
| `.claude/rules/sessions.md` | セッションの保存と復元 | §18 |
| `.claude/rules/loop.md` | 自律ループと起床 | §23 |
| `.claude/rules/security.md` | セキュリティ | §26 |
| `.claude/rules/supply-chain.md` | 重複の整理とサプライチェーン | §27 |
| `docs/DECISIONS.md` | 設計の背景。なぜこの構成か、技術スタック、未決事項、公開範囲 | §2, §3, §9, §19, §20 |

どのファイルがどのパスで読まれるかは、各ファイルの先頭の `paths` にある。
`§N` を引きたいだけなら `grep -n '^## N\.' .claude/rules/*.md docs/DECISIONS.md`。

---

## 完了の条件

```bash
pnpm verify     # typecheck + lint + test + カバレッジの線。緑にならないものを完了としない
pnpm shots      # 画面を描いて撮って測る（§22）。ブラウザが要るので verify には入れない
pnpm e2e        # 本物の Electron を起動して口を叩く（§30）。Forgejo とトークンが要る
pnpm walk       # v1 の 7 手を本物で通して撮る（§31）。実 API を呼び、GitHub と Forgejo に書く
```

線と数え方は `.claude/rules/testing.md`（§10、§28）。

---

## 変更するときの手順

1. **変えたい挙動を検査で先に書く。** 不変条件に触る変更では、守るものを明示してから直す（§11）。
2. **判断を伴う変更は測ってから決める。** この基盤の設計はほぼすべて実測に基づいている。
3. **該当する `.claude/rules/*.md` に追記する。** 決定、根拠になった数値、覆る条件。数値には日付。
   新しい節を足すなら番号は続きから（いまの最後は §32）。既存の番号は変えない。
4. **`pnpm verify` を通す。** push の前には `.githooks/pre-push` が、作者・lockfile・verify を見る。
   `.claude/settings.json` に `PreToolUse` を置けば、コミットの前にも `scripts/commit-gate.mjs` が回す。
5. **失敗したら `.claude/agent-mistakes.md` に書く。** 日付、何が起きたか、根本原因、教訓。
