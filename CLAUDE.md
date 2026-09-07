# Izuna

Claude Code を Codex のようにデスクトップから使う macOS アプリ。

このファイルは**単独で読めるコンテキスト**として書いてある。会話履歴を持たない
エージェントがこれだけ読んで作業を継続できることを目指す。事実と、その根拠に
なった実測を残す。推測は「未検証」と明記する。

- リポジトリ: `~/work/personal/izuna`
- 現状: 足場 + Claude Code セッション層まで。UI は未着手
- 最終更新の根拠となった CLI: `claude 2.1.263` / macOS 26.4.1 / Node 24.15 / pnpm 11.22

---

## 1. 何を作るか

`claude` CLI を**ヘッドレスで駆動**し、会話・思考・ツール実行・差分・承認を
GUI で描くデスクトップアプリ。ターミナルの中で TUI を動かすのではなく、
アプリが CLI をプロトコル越しに操作する。

**差別化の核は `/` コマンド。** 実行するだけでなく、横断的に見て・探して・
編集できるようにする。既存 GUI はどれも実行しかできない。

想定利用者は作者ひとり。汎用製品として競合に勝つことは目標にしない（§2）。

## 2. なぜこの構成か

### 既存調査の結論（2026-09 時点）

| 既存 | 立ち位置 |
|---|---|
| Claude Code 公式デスクトップアプリ | 差分・統合ターミナル・worktree 並列・PR 監視・Routines まで実装済み。最大の競合 |
| Nimbalyst（旧 Crystal） | Electron + embedded ghostty + 拡張SDK + iOS 版。MIT / 1.7k★ / 5,936 commits |
| Clarc | SwiftUI + SwiftTerm。スラッシュコマンド対応済み。Apache-2.0 / 365★ |
| ClaudeCodeSDK | Swift パッケージ。headless と Agent SDK の二バックエンド。MIT / 98★ |
| libghostty 系ターミナル | AI エージェント向けだけで20本超（agterm, limpid, cmux, moss, Forge…）。飽和 |
| Opcode（旧 Claudia） | 開発停止 |

機能面で公式や Nimbalyst に追いつく見込みはない。**自分専用の道具**として、
どちらにもない `/` の扱いに一点集中する。

### スタック選定

**Electron を選んだ。** 実装の主戦場は会話UI（ストリーミング markdown・差分・
シンタックスハイライト・折り畳めるツールコール）であり、そこは Web が圧倒的に
強い。ネイティブアドオンが素直に載り Chromium 固定で描画差に悩まない点で
Tauri より Electron。

**検討して落とした選択肢**：

- **Swift + AppKit/SwiftUI** — libghostty 統合は一級、ネイティブ感も最高。
  ただし会話UIの実装コストが本体作業になる。「Swift × ヘッドレス × libghostty」は
  調査上は本当に空いているので、方針転換するならここ
- **Tauri** — WKWebView とネイティブアドオンの取り回しで Electron に劣る
- **Flutter** — `flutter_ghostty` が 8 commits / 2 stars で実用外
- **Rust + GPUI（Zed）** — Zed 外の採用実績がほぼなく、詰まったとき助けがない

**libghostty は当面使わない。** 当初は libghostty 組み込みが企画の中心だったが、
Electron から使う道は `libghostty-vt-node`（2★ / 9 commits・パースのみ・
レンダリングしない）か Restty（libghostty-vt を WASM で動かし WebGPU で描く・
early-release・406★）しかなく、いずれも「ネイティブに組み込む」当初の趣旨から
離れる。ターミナルペインが必要になった段階で再判断する（§8）。

なお libghostty は Mitchell Hashimoto 本人が **API はアルファで安定保証なし**と
明言しており、将来 Swift フレームワークが公式提供される予定。現時点で深く
依存するのは早い。

## 3. 技術スタック

electron-vite 5 / Electron 39 / React 19 / TypeScript 5.9 / Vite 7 / pnpm。
`npm create @quick-start/electron` の react-ts テンプレートが出発点。

セキュリティは Electron の既定を維持する。`contextIsolation: true`、
renderer に `require` を露出しない、`contextBridge` で狭い型付き IPC のみ。

## 4. リポジトリ構成

```
src/shared/protocol.ts      stream-json のワイヤ型。ここが唯一の真実
src/main/claude/session.ts  双方向 stream-json で claude を飼うセッション層
src/main/claude/locate.ts   claude 本体とログインシェル環境の解決
scripts/smoke-session.ts    GUI 抜きで CLI との疎通を担保する確認スクリプト
CLAUDE.md                   このファイル
```

まだ無い: renderer の実装、IPC 登録、`/` コマンドの索引、権限承認。

**設計原則**: `ClaudeSession` は UI を知らない。CLI 相手の疎通は
`scripts/smoke-session.ts` が GUI 抜きで担保する。UI を壊さずにプロトコル層を
検証できる状態を保つこと。

## 5. stream-json 実測仕様

**すべて `claude 2.1.263` での実測。公開仕様ではない。CLI が上がったら測り直す。**

### 起動引数

```
claude --print
       --input-format stream-json --output-format stream-json
       --verbose                    # これが無いと -p でイベントが落ちる
       --include-partial-messages   # 逐次描画用の stream_event
       --replay-user-messages       # 送った user を echo。送達確認に使う
       --permission-prompts host    # 権限はアプリが答える（§6 に未解決あり）
       [--model X] [--permission-mode X] [--resume SESSION_ID]
```

1プロセス = 1会話。プロセスは turn をまたいで生き続け、stdin に1行流すと
1ターン進む。stdout は NDJSON で1行1イベント。

### 入力形式

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
```

スラッシュコマンドもこの `text` に `/foo args` として渡す。

### 観測されたイベント種別

`system:init` / `system:hook_started` / `system:hook_response` /
`system:status` / `system:thinking_tokens` / `system:permission_denied` /
`assistant` / `user` / `stream_event` / `rate_limit_event` / `result:success`

### `system:init` の中身

```
session_id, cwd, model, permissionMode, claude_code_version, output_style,
apiKeySource, tools[], slash_commands[], terminal_slash_commands[],
skills[], agents[], plugins[{name,path,source,version}],
mcp_servers[{name,status}], capabilities[], memory_paths,
messaging_socket_path, fast_mode_state
```

実測値の規模: slash_commands 317件 / skills 206件 / agents 53件。
プロジェクト・ユーザー・プラグインのスコープが **cwd 基準で解決済み**。

`capabilities` の実測値: `interrupt_receipt_v1`, `interrupt_cancel_queued_v1`,
`msg_lifecycle_v1`。中断まわりの制御プロトコルが使えることを示す。

### 重要な制約: init は入力前に来ない

**`system:init` は最初のユーザーメッセージを送るまで届かない。**
送信前に8秒待っても hook イベントしか来ない（実測で確認）。

したがって `/` パレットは init だけでは埋まらない。三段構えにする。

1. 初期表示はファイルシステム走査（即時・API コスト0）
   `~/.claude/commands`, `<cwd>/.claude/commands`, `~/.claude/skills`,
   `~/.claude/plugins/installed_plugins.json`（v2、`installPath` と scope を持つ）配下
2. 最初の `system:init` が届いたら**それを正として上書き**（CLI が権威）
3. init はプロジェクト単位でキャッシュし、次回起動時の初期値にする

走査は「補完を即座に出す」「説明文と引数ヒントを読む」ために必要で、
init は「実際に送れるコマンドの権威」。役割が違うので両方要る。

### その他の観測

- `result` に `total_cost_usd`, `permission_denials[]`, `terminal_reason`
- `rate_limit_event` に five_hour / seven_day の利用率と reset 時刻
- `assistant.message.content[]` の `tool_use` には `caller: {type:"direct"}` が付く
- ツール結果は `type:"user"` として来る（人間の発話ではない。UI で区別すること）
- `tool_result_meta[].non_execution_kind` に `"user-rejected"` などが入る

### ツール入力の実測例

```json
{"type":"tool_use","id":"toolu_...","name":"Write",
 "input":{"file_path":"/private/tmp/x/hello.txt","content":"hi"},
 "caller":{"type":"direct"}}
```

差分ビューはこの `input` から起こせる見込み（未実装）。

## 6. 権限承認 — 未解決

`--permission-prompts host` を付けて権限の要る操作をさせたが、
**`control_request` は一切飛んでこなかった。** 代わりにこうなった。

```json
{"type":"system","subtype":"permission_denied","tool_name":"Write",
 "tool_use_id":"toolu_...",
 "message":"Claude requested permissions to write to /path, but you haven't granted it yet."}
```

続いてツール結果が `is_error: true`、`tool_result_meta[].non_execution_kind:
"user-rejected"` で返る。つまり**何も聞かれずに自動拒否された**。

**未検証の仮説**: SDK ホストとしての名乗り（control protocol の initialize
ハンドシェイク）を stdin で先に送る必要がある。公式 Agent SDK の `canUseTool`
は control_request / control_response の往復で実現されているはずで、
その握手を我々が送っていないため CLI が「ホストは答えられない」と判断している。

**次にやること**: `@anthropic-ai/claude-agent-sdk` の実装か
`code.claude.com/docs/en/agent-sdk` を読み、ハンドシェイクの形式を確定させる。
これが決まるまで承認 UI は設計できない。

暫定回避策として `--permission-mode acceptEdits` や `bypassPermissions` は
使えるが、承認 UI が MVP の中核なので回避で済ませないこと。

## 7. 実装上の罠（実測で踏んだもの）

- **PATH**: Finder から起動した Electron はログインシェルの PATH を継承しない。
  mise / nvm / `~/.local/bin` 配下を丸ごと見失う。`$SHELL -ilc 'env -0'` で
  環境変数一式を取り、`claude` の場所もそこから解く（`src/main/claude/locate.ts`）
- **`--verbose` 必須**: `-p` と stream-json の組み合わせで、無いとイベントが落ちる
- **macOS に `timeout` が無い**。検証スクリプトで使わない（一度これで誤った測定をした）
- **ユーザーの hooks が混入する**: SessionStart / PreToolUse hook がアプリ起動の
  セッションにも効く。実測中、グローバル hook が大量の文脈を注入し、ツール実行も
  ブロックした。GUI から起動する場合の hook 制御（`--settings` 等）を要検討
- **top-level await が使えない**: tsx の既定は cjs 出力

## 8. スコープ

### MVP でやる

- [x] stream-json 双方向セッション（`ClaudeSession`）
- [ ] 会話ビュー: text / thinking / tool_use / tool_result の逐次描画
- [ ] **`/` パレット**（差別化の本体）: 走査 + init マージ、あいまい検索、引数ヒント
- [ ] 権限承認 UI（§6 の解決が前提）
- [ ] 差分ビュー（ツール入力から生成）
- [ ] セッション resume と履歴

### やらない（当面）

ターミナルペイン、libghostty、worktree 並列、PR 連携、モバイル、
Windows / Linux、複数エージェント対応。

## 9. 未決事項

**未検証の前提**（測れば消える。放置すると設計をやり直す）

1. **権限承認のハンドシェイク形式**（§6）— 最優先
2. `stream_event` の逐次適用アルゴリズム。partial から本文を組み立てる規則
3. `tool_use` input の網羅的な形状（Edit / MultiEdit / Bash / Task）
4. resume の挙動と、履歴 JSONL の場所・形式
5. 中断（`interrupt_receipt_v1`）の使い方
6. 異常系: プロセス死、認証切れ、CLI 更新でワイヤ形式が変わったとき

**未決の仕様**（決めれば消える）

1. **`/` パレットの到達点**。「探して・見て・編集できる」は方向であって仕様ではない。
   閲覧・検索までか、その場で書き換えるところまでか
2. 会話ビューの状態モデル。イベント列 → UI 状態の変換規則。設計の心臓
3. 差分をツール入力から起こすか、ファイルシステムを読むか
4. ターミナルをいつ入れるか。入れるなら xterm.js / Restty / node-pty のどれか。
   libghostty を諦めるかがここで決まる

## 10. 検証のしかた

```bash
pnpm install
npx tsx scripts/smoke-session.ts   # CLI との疎通。実 API を呼ぶので少額かかる
pnpm typecheck
pnpm dev                           # 足場の起動確認（UI はテンプレートのまま）
```

`scripts/smoke-session.ts` が通らなくなったら、CLI 側のワイヤ形式が変わった
可能性を最初に疑うこと。§5 を測り直す。
