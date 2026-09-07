# Izuna

Claude Code を Codex のようにデスクトップから使う macOS アプリ。

このファイルは**単独で読めるコンテキスト**として書いてある。会話履歴を持たない
エージェントがこれだけ読んで作業を継続できることを目指す。事実と、その根拠に
なった実測を残す。推測は「未検証」と明記する。

- リポジトリ: `~/work/personal/izuna` / upstream は https://github.com/Watakumi/izuna （**private**・§20）
- **何を作るかは [docs/GOAL.md](docs/GOAL.md)。** このファイルは*どう*作るかを書く
- 設計の決定: https://claude.ai/code/artifact/873094d6-cdf6-46b4-b488-a69ab9e3641e （元は `design/`）
  **画面そのものは描かない。実装が正。** 理由は §16
- 現状: **MVP は完了**（会話・パレット・承認・差分・worktree・Forge・ターミナル・
  セッションの一覧と resume）。次は v1 の 7 手を通しで実機確認（docs/GOAL.md）
- **`pnpm verify` は緑**（207件）。壊したら直してから進むこと
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

**libghostty は `ghostty-web` で使っている（段6 で実装済み）。** 当初は
「Electron から使う道が細い」と判断して見送ったが、Nimbalyst のソースを読んで
実用経路が判明した。`ghostty-web`（coder 製）は **libghostty-vt の公式 WASM
ビルド**で、xterm.js 互換 API・Canvas レンダラ・Kitty graphics・OSC 8 を持つ。
Nimbalyst は `ghostty-vt.wasm` を同梱し `node-pty` と組み合わせている。
当初の企画趣旨（libghostty を使う）はこれで果たした。

実装して分かったこと: **WASM は base64 で ESM に埋め込まれている**ので、
`ghostty-vt.wasm` を別途配る必要がない（Nimbalyst は同梱している）。
`init()` を呼ぶだけで済む。代償は renderer のバンドルが約 650KB 増えること
（元の wasm が 416KB、base64 で約 555KB）。

以前ここで検討して落としたのは `libghostty-vt-node`（2★ / 9 commits・
パースのみ）と Restty（WebGPU・early-release）。

なお libghostty は Mitchell Hashimoto 本人が **API はアルファで安定保証なし**と
明言しており、将来 Swift フレームワークが公式提供される予定。現時点で深く
依存するのは早い。

## 3. 技術スタック

electron-vite 5 / Electron 39 / React 19 / TypeScript 5.9 / Vite 7 / pnpm / vitest 5。
`npm create @quick-start/electron` の react-ts テンプレートが出発点。

**`@anthropic-ai/claude-agent-sdk` を使う（0.3.263 に固定）。** 生の NDJSON を
自前で読むのはやめた。理由は §6。SDK は依存ゼロ・4.8MB で、CLI は同梱せず
`pathToClaudeCodeExecutable` で指した既存の `claude` を起動する。

**版はパッチ番号で連動する**（SDK `0.3.263` ↔ CLI `2.1.263`）。ずれたまま使うと
SDK が知らないイベントを CLI が吐く。`test/auth.test.ts` が門になっている。

**テストは vitest。** `node --test`(依存ゼロ)を検討したが、この構成では使えない。
import が `from '../../shared/protocol'` と拡張子なしで書かれていて、Node 24 の
型剥がしはこれを解決できない(実測 2026-09-07: `ERR_MODULE_NOT_FOUND`)。
全 import に `.ts` を足すのは本末転倒なので、Vite が既にあることを使う。

セキュリティは Electron の既定を維持する。`contextIsolation: true`、
renderer に `require` を露出しない、`contextBridge` で狭い型付き IPC のみ。

## 4. リポジトリ構成

```
src/shared/protocol.ts      stream-json のワイヤ型。ここが唯一の真実
                            パースと版検査もここ(純粋関数。プロセスを知らない)
src/main/claude/session.ts  双方向 stream-json で claude を飼うセッション層
src/main/claude/locate.ts   claude 本体とログインシェル環境の解決
scripts/smoke-session.ts    人が目で見る疎通確認。実 API を呼ぶ
scripts/smoke-permission.ts 権限承認の握手が成立するかを見る。実 API を呼ぶ
src/main/terminal.ts        PTY を持つだけ。バイト列を解釈も加工もしない
scripts/record-fixture.ts   実セッションの NDJSON を fixture として録る。実 API を呼ぶ
test/protocol.test.ts       録画に対する門。網も費用も要らない
test/auth.test.ts           認証経路（Pro プランか API キーか）と SDK/CLI の版の門
test/fixtures/session-safe.ndjson  --safe-mode で録った記録。**版管理に入る**。門はこれを見る
test/fixtures/session-full.ndjson  素で録った記録。**gitignore**（§11）。手元専用
CLAUDE.md                   このファイル
```

まだ無い: renderer の実装、IPC 登録、`/` コマンドの索引、権限承認。

**設計原則**: `ClaudeSession` は UI を知らない。**パースはプロセスを知らない**
(`parseLine` は `shared/protocol.ts` の純粋関数で、`spawn` に触れない)。
この 2 段があるので、UI を壊さずにプロトコル層を検証でき、
かつプロトコル層の検証に実 API が要らない。

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

**この制約は SDK 採用で回避できた（2026-09-07）。** `query.supportedCommands()` が
制御要求として一覧を返すので、init を待つ必要がない。実測で起動直後に **316 件**。

```ts
type SlashCommand = { name: string; description: string; argumentHint: string; aliases?: string[] }
```

**ファイルシステム走査は不要になった。** 以前ここに書いていた三段構え
（走査で初期表示 → init で上書き → キャッシュ）は**破棄**する。説明文も引数ヒントも
CLI が返すので、自前で `~/.claude/commands` を読む理由がもう無い。

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

## 6. 権限承認 — 解決済み（2026-09-07）

### 何が起きていたか

生の NDJSON を自前で読んでいたとき、`--permission-prompts host` を付けても
`control_request` は**一度も飛んでこなかった**。代わりにこうなる。

```json
{"type":"system","subtype":"permission_denied","tool_name":"Write",
 "message":"Claude requested permissions to write to /path, but you haven't granted it yet."}
```

続いてツール結果が `is_error: true` / `non_execution_kind: "user-rejected"` で返る。
**何も聞かれずに自動拒否**されていた。

### 原因

CLI は「SDK ホストとして名乗った相手」にしか `can_use_tool` を投げない。
名乗りは control protocol の往復である。

```
ホスト → CLI  {"type":"control_request","request_id":"...","request":{"subtype":"initialize",...}}
CLI → ホスト  {"type":"control_response","response":{"request_id":"...",...}}
CLI → ホスト  {"type":"control_request","request_id":"...","request":{"subtype":"can_use_tool",...}}
ホスト → CLI  {"type":"control_response","response":{...PermissionResult}}
```

`can_use_tool` のほかに `hook_callback` / `mcp_message` / `elicitation` があり、
`sdk.d.ts` は 8,804 行。**手で実装すると、これを自前で追い続けることになる。**

### どうしたか

`@anthropic-ai/claude-agent-sdk` に委ねた（§3）。`canUseTool` コールバックを
渡すだけで握手が成立する。`ClaudeSession` はそれを `permission` イベントとして
UI に流し、`respondToPermission()` で答えを返す facade になっている。

**実測（`scripts/smoke-permission.ts`）**:

```
★ 承認を求められた
   tool       : Write
   input      : {"file_path":".../hello.txt","content":"hi"}
   toolUseId  : toolu_0189pcpmaNN4KuHB1F4ndn1L
   suggestions: [{"type":"setMode","mode":"acceptEdits","destination":"session"}]
```

### 承認 UI の材料

```ts
type PermissionResult =
  | { behavior: 'allow';  updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny';   message: string; interrupt?: boolean }
```

`suggestions` に **CLI 側が「常に許可」の中身を提案してくる**ので、
ボタンの意味を自前で決めなくてよい。`PermissionUpdate.destination` は
`'session' | 'localSettings' | 'projectSettings' | 'userSettings' | 'cliArg'` で、
「今回だけ / このセッション中 / 常に」がそのまま対応する。

### fail-closed を保つこと

答えないまま放置すると CLI は待ち続ける。`ClaudeSession` は
**中断シグナルとセッション終了の両方で deny を返す**ようにしてある。
ここを「握手に失敗したら acceptEdits に落とす」と書き換えると
**fail-open に反転する**ので、変更するときは意図してやること。

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
- **hook 混入の正体はプラグイン**(2026-09-07 に特定)。`~/.claude/settings.json` と
  `settings.local.json` の hooks は**どちらも空**だった。犯人は `everything-claude-code`
  プラグインで、**26 本**登録している —— PreToolUse 8 / PostToolUse 8 / Stop 6 /
  SessionStart 1 / PreCompact 1 / PostToolUseFailure 1 / SessionEnd 1。
  ツール実行を止めていたのが PreToolUse、文脈を大量注入していたのが SessionStart。
  **`--settings` で空を渡してもプラグイン由来は消えない見込み(未検証)**
- **hook の遮断手段（2026-09-07 に実測）**。メッセージ送信前に hook は出そろうので、
  **API を呼ばずに測れる**（この手を使うこと）。

  | 手段 | hook | 副作用 |
  | --- | --- | --- |
  | 履歴の無いディレクトリで起動 | **消えない**（4,065 B） | cwd を変えても注入される |
  | `--safe-mode` | **消える**（0 B） | plugins / skills / custom commands も落ちる。ただし `slash_commands` は空にならず 52 件残る（組み込み分） |
  | `--bare` | **消える**（0 B） | 認証が `ANTHROPIC_API_KEY` 固定。この環境は OAuth（`apiKeySource: "none"`）なので送信時に落ちる見込み（**未検証**） |

  **hook だけを落とす手段は見つかっていない。**
- **SDK は `systemPrompt` を省略すると Claude Code の既定プロンプトを使わない**
  （2026-09-07 に実地で踏んだ）。作業ディレクトリも auto-memory も git status も、
  Claude Code の振る舞いの指示そのものも入らない。症状は分かりにくい ——
  エージェントは**自分がどこにいるか知らないまま、それらしいパスを作り話する**。

  実測: 一時ディレクトリで起動し「cwd はどこか、ツールを使わずに答えよ」と
  聞くと `I do not know.` が返る。画面上は、存在しない
  `/Users/<別人>/dev/<知らないプロジェクト>/notes.txt` に書こうとして
  `EACCES` で失敗し、そのあと `pwd` を撃って正しい場所に書き直す、という
  挙動として現れた。

  対処: `systemPrompt: { type: 'preset', preset: 'claude_code' }` を渡す。
  多人数で prompt cache を共有したい場合のみ `excludeDynamicSections: true`
  を検討する（cwd などが system ではなく最初の user メッセージに移る）。
- **拒否は結果の文面から判定してはいけない**（同日、自分で作り込んだバグ）。
  `EACCES: permission denied` を `/permission/i` で拾い、**ファイルシステムの
  失敗を人間の拒否として表示していた**。SDK の `user` メッセージには
  `tool_result_meta.non_execution_kind` が来ない（生の NDJSON にはある）ので、
  **拒否した側が `tool_use_id` を覚える**のが唯一正しい
  （`transcript.ts` の `markDenied`）。
- **`before-quit` で無制限に待つと、アプリが終了できなくなる**（2026-09-07 に踏んだ）。
  後片付けのために `event.preventDefault()` して `stopAllSessions()` を待つ実装に
  していたが、待ちが返らないと `Ctrl+C` を何度押しても Electron が落ちない。
  さらに **`Ctrl+C`（SIGINT）は `before-quit` を通らない**ので、
  そもそもハンドラが効いていない経路もある。

  対処は 3 段:
  1. `shared/wait.ts` の `settle()` で、片付けの待ちに必ず上限を切る
  2. `process.on('SIGINT' | 'SIGTERM')` を自分で受ける
  3. それでも駄目なとき用に `process.exit(0)` の保険を置く

  **孤児が 1 つ残るほうが、終われないアプリよりましである。**
  詰まったら `pkill -f 'izuna/node_modules/.pnpm/electron'`。
- **`pnpm dev` は main プロセスを入れ替えない**（2026-09-07 に踏んだ）。
  renderer は HMR で更新されるが main はそのまま残る。IPC の口を足した直後は
  食い違い、`No handler registered for 'izuna:repo'` のような**原因を指さない
  エラー**になる。実際に 5 時間前に起動した main で踏んだ。

  対処: `shared/ipc.ts` の `IPC_VERSION` を、**口を足したら上げる**。
  renderer が起動時に main へ問い合わせ、食い違っていたら赤い帯を出す。
  詰まったら `pkill -f 'izuna/node_modules/.pnpm/electron'` して `pnpm dev`。
- **CSP が WASM のコンパイルを止める**（2026-09-07 に踏んだ）。electron-vite の
  雛形は `script-src 'self'` で、`ghostty-web` が
  `WebAssembly.compile(): ... violates the following Content Security policy` で落ちる。

  **`'unsafe-eval'` を足さないこと。** あれは JS 文字列の `eval` まで許す。
  `'wasm-unsafe-eval'` は WASM のコンパイルだけを許す狭い許可で、こちらを使う。
  WASM は base64 の `data:` URL として埋め込まれているので、`connect-src` にも
  `data:` が要る（fetch がそこを読む）。
- **pnpm 11 は `allowBuilds` を埋めるまで install を拒む**。`pnpm-workspace.yaml` が
  雛形のまま(`set this to true or false`)だったので、`pnpm verify` が**起動もしなかった**。
  `package.json` の `pnpm.onlyBuiltDependencies` は 11 では読まれない(移設先が workspace 側)

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

## 9. 未決事項

**未検証の前提**（測れば消える。放置すると設計をやり直す）

1. **権限承認のハンドシェイク形式**（§6）— 最優先
2. `stream_event` の逐次適用アルゴリズム。partial から本文を組み立てる規則
3. `tool_use` input の網羅的な形状（Edit / MultiEdit / Bash / Task）
4. resume の挙動と、履歴 JSONL の場所・形式
5. 中断（`interrupt_receipt_v1`）の使い方。
   **いまの `ClaudeSession.interrupt()` は子プロセスに `SIGINT` を送っている。**
   コメントは「プロセスは生かしたまま」だが、1 プロセス = 1 会話なので
   会話ごと落としている可能性がある。`capabilities` に中断の制御プロトコルが
   出ているのだから、本来はそちらのはず。**測っていない**
6. 異常系: プロセス死、認証切れ、CLI 更新でワイヤ形式が変わったとき
   → 6 のうち「CLI 更新」だけは §11 で塞いだ。残りは未着手
7. ~~**プラグイン hook の遮断手段**~~ → **解決（2026-09-07）**。
   `settingSources: ['project','local']` で `~/.claude/settings.json` を読まなくなり、
   そこの `enabledPlugins` 経由の hook が落ちる。決定は §13。
   （以下は経緯として残す）
   izuna が起動する `claude` は利用者の環境のプラグインを引き継ぐ。
   これは実装の罠ではなく**仕様の問題**で、他人の環境では
   「izuna のバグ」に見える不具合として出る。
   → 遮断手段の比較は §7 で埋めた（`--safe-mode` / `--bare` は効く、cwd 変更は効かない）。
   **残っているのは「hook だけを落とす手段」と、`--bare` が OAuth で動くかどうか**

**未決の仕様**（決めれば消える）

1. **`/` パレットの到達点**。「探して・見て・編集できる」は方向であって仕様ではない。
   閲覧・検索までか、その場で書き換えるところまでか
2. 会話ビューの状態モデル。イベント列 → UI 状態の変換規則。設計の心臓
3. 差分をツール入力から起こすか、ファイルシステムを読むか
4. ターミナルをいつ入れるか。入れるなら xterm.js / Restty / node-pty のどれか。
   libghostty を諦めるかがここで決まる

## 10. 完了の条件

```bash
pnpm verify     # typecheck + test。これが緑にならないものを完了としない
```

補助（どちらも**実 API を呼ぶ**ので、verify には入れていない）。

```bash
pnpm install
npx tsx scripts/smoke-session.ts    # いま CLI と話せるか。人が目で見る
npx tsx scripts/record-fixture.ts   # そのとき CLI が何を吐いたかを録る
pnpm dev                            # 足場の起動確認（UI はテンプレートのまま）
```

`pnpm verify` が「手元の claude は X、実測は Y」で落ちたら、CLI が上がっている。
§5 を測り直し、fixture を録り直し、`MEASURED_CLI_VERSION` を更新する。**順番を守る**
—— 定数だけ先に上げると、検査は緑になるが中身は測っていないことになる。

## 11. 検証の土台（2026-09-07 に入れた）

### なぜ入れたか

CLAUDE.md は §5 を「claude 2.1.263 での実測。公開仕様ではない」と正しく書いていた。
だが**上がったことを検知する仕掛けが無かった**。`smoke-session.ts` は実 API を
呼ぶので費用が理由で手でしか回らず、事実上いつでも回る門が 1 つも無い状態だった。
CLI が黙って上がってワイヤが変われば、気づくのは UI が壊れたときになる。

### 決めたこと

| 決定 | 理由 |
| --- | --- |
| テストは **vitest** | `node --test` は拡張子なし import を解決できない（§3、実測） |
| パースを **`shared/protocol.ts` の純粋関数に出す** | `spawn` に密着していると、CLI を叩かないと何も検証できない |
| **録画した NDJSON を版管理に入れる** | 網も費用も要らない検査ができる。加工しない —— 加工した時点で観測ではなく解釈になる |
| 版のずれは **verify で落とし、アプリでは落とさない** | 版が上がってもワイヤが変わるとは限らない。**上がるたびに起動しない道具は使われなくなる**。止める代償が安いのは verify の側 |
| fixture 未録は **skip ではなく赤** | skip する検査は門ではない。赤が「まず録れ」の合図になる |
| fixture は **2 本録る**（2026-09-07 追加） | 素で録ると hook が過去セッションの要約（私的な会話内容）を注入し、そのままでは commit できない。**後から削るのは「加工しない」に反する**ので、代わりに観測条件を統制する。`--safe-mode` の safe 版を commit し、full 版は gitignore |
| full 版の検査だけは **skip してよい** | 「まだ録っていない」ではなく「**設計上 commit しない**」ものだから。門の役は safe 版が負う |

### 録画して分かったこと（2026-09-07）

録ってみたら、**申し送りが想定していたより広い情報が入っていた**。
「`session_id` / `cwd` / `uuid` に環境依存の値」どころではなかった。

| 行 | 種別 | サイズ | 中身 |
| --- | --- | --- | --- |
| 2 | `hook_response` | 4,661 B | **過去セッションの要約**（私的な会話内容） |
| 3 | `system:init` | 29,140 B | プラグイン・スキル・MCP の全目録、ホームパス |

`watakumi` が 10 箇所、`messaging_socket_path` に PID 由来のソケットパス。
`git remote` は未設定なので実害は今のところ無いが、公開すると git 履歴から
消すのが面倒になる。そこで 2 本立てにした（決定は上の表）。

safe 版は 17 行・init 2,219 B。過去要約 0 / hook イベント 0 / `watakumi` は
cwd の 2 箇所のみ。**`--safe-mode` でも `slash_commands` は空にならない**
（52 件。組み込み分が残る）ので、門としては十分に働く。

### いまの状態

`pnpm verify` は**緑**（14 件）。内訳は safe 版に対するパース 6 件、
パースの端 4 件、手元の CLI の版 1 件、full 版に対する 2 件、fixture の存在 1 件。

`test/fixtures/session-full.ndjson` は手元にあり、gitignore 済み。
これが無い環境では full 版の 2 件が skip され、残り 12 件で緑になる。

### 次のセッションがやること

§11 の宿題は片付いた。**§9-6 の「CLI 更新」だけが消えた。残りの未検証は減っていない。**
次に手をつけるなら、優先順位は §9 の順。**1 の権限承認ハンドシェイクが最優先**で、
これが決まらないと承認 UI は設計できず、UI を先に作れば手戻りになる。

### 触っていないこと

- **§6 の権限承認は手つかず。** ただし設計の順番として、
  ハンドシェイクを実装する前に「**握手が確立できなかったときどう振る舞うか**」を
  決めること。いまの「何も聞かれず自動拒否」は fail-closed 側に倒れているが、
  それは設計した結果ではなく偶然である。実装のときに
  「握手に失敗したら `acceptEdits` に落とす」と書くと、そこで fail-open に反転する
- 既存文書の推敲（§2・§6・§8 に長すぎる文が 3 件ある）
- renderer、IPC、`/` パレット、差分ビュー
- **`ClaudeSession.interrupt()` の SIGINT 疑い（§9-5）**。録画とは無関係なので触っていない

---

## 12. ブレインと実行役の協調（2026-09-07 調査）

GOAL.md の段 4。**自前で作る部分は少ない。Claude Code に組み込みの機構がある。**

### 使えるツール（実測）

`--safe-mode` の素の状態でも、`system:init` の `tools` に全部入っていた。
プラグインもスキルも要らない。

```
Task  SendMessage  ListAgents
TaskCreate  TaskList  TaskUpdate  TaskStop  TaskOutput
EnterWorktree  ExitWorktree
```

### 三つの層

| 層 | 中身 | 使えるか |
| --- | --- | --- |
| `Task` サブエージェント | 1 セッション内で完結。使い捨て | **不足**。往復も反省もできず worktree も分かれない |
| セッション間メッセージング | `SendMessage` が別セッションに届く（Remote Control 経由なら別マシンにも） | **本命** |
| 管理されたチームメイト | lead の `Task` 呼び出しを横取りし、独立した `query()` として起こす | 最も自由。Nimbalyst がこれ |

Nimbalyst の `TeammateManager.ts` の要点:

```
const agentType = taskInput.subagent_type || 'general-purpose'
```

`Task` を横取りして独立セッションを spawn する。`agentId` は `name@teamName`。
lead → チームメイトは `query.streamInput()` で差し込み、逆向きは
`pendingTeammateToLeadMessages` のキューで流す。idle になっても
`sessionId` を保持して resume できるようにしている。

### 反省ループの起点は hook

`HOOK_EVENTS` に、この用途の穴が開いている。

| hook | 使いどころ |
| --- | --- |
| `TeammateIdle` | 実行役が手を止めた瞬間。**ブレインが結果を見て指示を返す起点** |
| `TaskCreated` / `TaskCompleted` | 作業単位の受け渡し |
| `SubagentStart` / `SubagentStop` | 起動と終了 |
| `WorktreeCreate` / `WorktreeRemove` | worktree の生成と回収 |

設定 `teammateMode: 'auto' | 'tmux' | 'iterm2' | 'in-process'` で実行形態を選べる。

### 罠: 権限モードのクラス不一致でメッセージが黙って保留される

SDK の設定 `crossSessionInbound` の説明より（原文の要約ではなく趣旨）:

> `'accept'` は配送、`'hold'` は本人の確認待ちで保留、`'refuse'` は拒否。
> **未設定の場合はモード同値で判定**され、送信側と受信側の権限モードのクラスが
> 一致するとき（bypass↔bypass または prompting↔prompting）だけ自動配送される。
> 不一致の送信者のメッセージは承認待ちで保留される。

**ブレインを承認モード、実行役を bypass にすると、指示が黙って止まる。**
「送ったのに動かない」の典型的な原因になる。Izuna 側で両者のモードクラスを
揃えるか、`crossSessionInbound: 'accept'` を明示すること。

関連して `isolatePeerMachines`（Remote Control で別マシンの peer に届く前に
明示承認を求める）がある。

### コンテキストは共有されない ―― 共有はフォルダで行う

**ブレインと実行役は別セッションなのでコンテキストウィンドウを共有しない。**
共有されるのはメッセージとファイルシステムだけ。

これは利点である（実行役が窓を使い切ってもブレインの文脈は汚れない）。
だが「送ったメッセージ」だけに頼ると、**圧縮を跨いだ瞬間に消える**。
そこで共有フォルダを一つ決め、全員に渡す。

`Options.additionalDirectories`（CLI の `--add-dir` 相当）で、
ブレインと実行役の**全員に同じ絶対パスを渡す**。

```
~/.izuna/teams/<team>/
  brief.md        ブレインが最初に書く。狙い・制約・受け入れ条件
  tasks/          作業単位。担当・状態・完了条件を 1 ファイル 1 件
  summaries/      実行役が手を止めるときに書く要約
  decisions.md    反省で決まったこと（追記のみ）
  log.md          やりとりの記録（追記のみ）
```

**worktree の中に置かない。** 実行役はそれぞれ別の worktree にいるので、
リポジトリ相対のパスは共有にならない。リポジトリの外に置き、
絶対パスで渡す。PR にも混ざらない。

### 1 ファイル 1 書き手

**同じファイルを 2 者が書くと、ロックなしでは必ず壊れる。** だから書き手を割る。

| ファイル | 唯一の書き手 | 読む |
| --- | --- | --- |
| `brief.md` | ブレイン | 全員 |
| `tasks/NN-*.md` | ブレイン | 全員 |
| `summaries/*.md` | **その実行役だけ** | ブレイン |
| `decisions.md` | ブレイン（追記のみ） | 全員 |
| `log.md` | **Izuna**（エージェントは書かない・追記のみ） | 人間 |

これで排他制御が要らなくなる。実行役は `tasks/` を書かない ——
状態を変えたいことがあれば `summaries/` に書き、ブレインが `tasks/` に反映する。

### 形は雛形とテストで決めてある

**散文で決めた形は守られない。** `templates/team/` が実物の雛形で、
`test/team.test.ts` がそれを読めることを検査している。
形を変えるなら雛形を変え、テストを通すこと。

読み書きは `src/shared/team.ts` の純粋関数（プロセスを知らない。§4 の原則）。

```
brief.md        issue / created + 狙い・制約・受け入れ条件・触らない範囲
tasks/NN-*.md   id / title / assignee / branch / status / depends_on / paths / updated
summaries/*.md  task / by / at / outcome + やったこと・判断が要る点・触ったファイル
decisions.md    ## <ISO8601> · <対象|-> · <誰>  を見出しにした追記
log.md          <ISO8601>\t<from>→<to>\t<種別>\t<対象>\t<一言>  のタブ区切り
```

`status` は `todo` / `doing` / `idle` / `done` / `blocked` の 5 つだけ。
**`idle` は「実行役が手を止めた」= ブレインが読む番**を意味する
（`TeammateIdle` に対応する）。不正な値は黙って `todo` に倒さず、パースで落とす。

### 並列させてよいかは実行前に検査する

**並列で最も壊れるのは、2 つの実行役が同じファイルを触ること。**
`tasks` の `paths` が重なるものを同時に走らせない。

```ts
pathCollisions(tasks)   // status が doing / idle のものだけを見て、重なりを返す
readyTasks(tasks)       // depends_on が満たされていて未着手のもの
```

`brief.md` の「触らない範囲」と合わせて、**実行役を起こす前に必ず通す**。

### 規律

- **`decisions.md` と `log.md` は追記のみ。** 黙って書き換えない。
  書き換えを許すと、誰がいつ何を決めたのかが復元できなくなる
- **実行役は終わるときに `summaries/` へ要約を書く。**
  「判断が要る点」の節を必ず持たせる —— ここが反省ループの入口で、
  無いとブレインが全差分を読み直すことになり、ブレインの窓が保たない

圧縮を跨いで残るのはこのフォルダだけである。口頭で伝えたことは残らない。

### 実測（2026-09-07・段4 の着手前に測った）

`scripts/` には残していない使い捨ての probe で、一時ディレクトリに
ブレインを起こし「`Task` でサブエージェントを 1 つ起こしてファイルを作らせろ」
と頼んだ結果:

```
[ブレイン] tool_use: Agent
task_started: general-purpose / background=false
  [実行役] tool_use: Write
★ 承認 #1: Write / agentId=a9d98cdcaa1a7c6e6      ← ホスト（＝人間）に来た
  [実行役] Done. Created file .../from-executor.txt
task_notification: completed
ファイル: "done by executor"
```

**確定した事実:**

| 問い | 答え |
| --- | --- |
| 実行役の承認は誰に行くか | **ホストに来る。** `canUseTool` に `agentID` 付きで届く |
| 誰の要求か区別できるか | できる。ブレイン本体は `agentID` が undefined |
| ライフサイクル | `task_started` → `task_progress` → `task_updated` → `task_notification` |
| 実行役の発話 | `forwardSubagentText: true` で `parent_tool_use_id` 付きで届く |
| ツール名 | **`Agent`**（`Task` ではない。`ToolSearch` 経由で解決される deferred tool） |

**GOAL.md の完成の定義 5（承認は人間が持つ）は、機構としても成立する。**
`agentID` があっても人間に上げるのは設計判断であって、機構の都合ではない。

### worktree はサブエージェントに組み込みで与えられる

設定 `worktree` に **agent isolation** という一級の概念がある。

```
worktree.baseRef       'fresh'（既定・origin/<default> から）| 'head'
worktree.bgIsolation   'worktree'（既定・EnterWorktree を呼ぶまで本体の Edit/Write を塞ぐ）| 'none'
worktree.symlinkDirectories  node_modules 等を本体から張って容量を節約
worktree.sparsePaths   大きな monorepo で必要な範囲だけ書き出す
```

`--worktree` / `EnterWorktree` / **agent isolation** の 3 つに効く。

> **⚠ ここに「worktree を Izuna が自前で配る必要はない」と書いていたが、
> 誤読だった**（2026-09-08 に実測して訂正）。`bgIsolation` の説明は
> 「背景**セッション**の Edit/Write を `EnterWorktree` が呼ばれるまで**塞ぐ**」
> であって、**作るとは書いていない**。下の実測を見よ。

### 実測（2026-09-08）——「誰が worktree を作るのか」

一時リポジトリに `.claude/settings.json` で
`{ worktree: { baseRef: 'head', bgIsolation: 'worktree' } }` を置いて測った。

| 経路 | 結果 |
| --- | --- |
| **サブエージェントを背景で起こす** | **worktree は作られない。** 本体の作業ツリーに直接書いた（`background_tasks_changed` は出ているので背景では走っている） |
| **エージェントが `EnterWorktree` を呼ぶ** | **作られる。** `<project>/.claude/worktrees/<名前>`、ブランチは `worktree-<名前>`、`locked`。本体にファイルは出来ない |

**結論: worktree を作るのはエージェントだが、勝手にはやらない。**
`EnterWorktree` を呼ばせる必要がある。**人に選ばせるものではない**
（人が考えるのは「この Issue をやりたい」であって worktree ではない）。

### 決めたこと（2026-09-08）—— Izuna は worktree を作らない

置き場所が 2 つあった。CLI は `<project>/.claude/worktrees/`、Izuna は
`~/.izuna/worktrees/<repo>/<branch>`。`worktree.location` の設定はあるが、
型定義に「CLI（`--worktree` / `EnterWorktree` / agent isolation）は
**まだ読まない**」と明記されているので、設定で寄せることはできない。

**`EnterWorktree` に一本化した。** Izuna の作る側を落とした。

| 落としたもの | 残したもの |
| --- | --- |
| `createWorktree` の IPC・main・preload | `listWorktrees` / `removeWorktree` / `worktreeStatus` |
| `worktreePathFor` / `validateNewWorktree` | `parseWorktrees` / `slugifyBranch` / `canRemove` |
| 「新しいセッション」の worktree チェックとブランチ欄 | Worktrees 画面（見る・畳む） |
| `shared/branch.ts` 一式（Issue からブランチ名を作っていた） | —— |

`git worktree list` を読んでいるので、**エージェントが作ったものはそのまま
一覧に出る**。ブランチ名も CLI が `worktree-<名前>` で付けるので、
Izuna が Issue から作る必要がなくなった。

`test/worktree.test.ts` の「Izuna は worktree を作らない」が門。
作る経路を戻すなら、**まず「どちらに置くか」を決め直すこと。**

**なぜ間違えたか。** SDK の型に `agent isolation` と書いてあるのを見て、
「隔離してくれる」＝「worktree を配ってくれる」と読んだ。実際は
「`EnterWorktree` が呼ばれるまで**塞ぐ**」だった。**説明に書いていない動作を
足して読んでいた。** しかも誤った結論を §12 に書いたまま、それと矛盾する
UI（人に worktree を選ばせる）を作り、指摘されるまで 2 回その画面を直した。

### まだ測っていないこと

- `TeammateIdle` hook が Agent SDK 経由でも発火するか（今回の probe では
  `Agent` ツールが同期で完了したため、idle に入る場面が無かった）
- `SendMessage` の宛先解決（`ListAgents` が返す名前の形）
- `teammateMode` ごとの挙動差
- ~~agent isolation を有効にしたときの worktree の実際の置き場所~~ → **測った（上）**
- `EnterWorktree` を実行役（サブエージェント）が呼べるか。
  上の実測はブレイン本体が呼んだもの

---

## 13. 設定の読み込み範囲（2026-09-07 に決定）

**`settingSources: ['project','local']` を使う。** `'user'` は読まない。

### 測った結果

`supportedCommands()` はメッセージ送信前に呼べるので、**API 課金なしで**測れる。

| `settingSources` | 合計 | 組込 | 自作スキル | プラグイン |
| --- | --- | --- | --- | --- |
| 省略（CLI と同じ）/ `['user',…]` / `['user']` | 316 | 52 | 5 | 259 |
| `['project','local']` / `[]` | 52 | 52 | 0 | 0 |

**スイッチは `'user'` スコープ全体で、プラグインだけを外すことはできない。**

### 決めたこと

プラグイン由来の 259 件は Izuna には要らない。加えて `'user'` を読むと
`enabledPlugins` 経由の hook（PreToolUse 8 / SessionStart 1 ほか計 26 本）が
効いてしまい、ツール実行が止まったり過去セッションの要約が注入されたりする。

`'project'` は残す。**外すとプロジェクトの `CLAUDE.md` が読まれなくなる。**

### 代償と、その取り戻し方

**利用者自身のスキル 5 件も同時に落ちる**（`~/.claude/skills/` は user スコープ）。
必要なものは、そのプロジェクトの `.claude/skills/` に置けば `'project'` で拾える
（実体を置いてもシンボリックリンクでもよい）。

段2（`/` パレット）で「読み込む範囲」をセッションごとに選べるようにするなら、
`SessionOptions.settingSources` は既に口が空いているので、UI を足すだけで済む。

---

## 14. 課金と枠（2026-09-07 実測）

**Izuna は Pro プランの OAuth で動く。API キーは使わない。**
SDK 経由（＝ Izuna が実際に通る経路）で録ったデータより:

```
apiKeySource : "none"        claude.ai の OAuth ログイン
ANTHROPIC_API_KEY            未設定
rateLimitType: five_hour     サブスクリプションのレート制限
windows      : five_hour 3% / seven_day 5%
overageStatus: allowed / isUsingOverage: false
costBasis    : "list"        定価換算。請求額ではない
provider     : firstParty
```

### 枠はターミナルの Claude Code と共有

`five_hour` / `seven_day` は同じサブスクリプションの窓である。
**Izuna を回すと、ターミナルの Claude Code と同じ枠を食う。別枠は増えない。**

実行役を並列で走らせる設計（段3・段4）なので、ここは効いてくる。
`rate_limit_event` の `unifiedWindows` を UI に出して、
枠の残りが見えるようにすること。

### 金額表示は「目安」と明示する

`costBasis: "list"` は定価換算であって請求額ではない。
そのまま `$0.0145` と出すと課金されているように読めるので、
「目安」と添える（`App.tsx` の註）。

### これを壊さないための門

`test/auth.test.ts` が `apiKeySource` を検査している。
`ANTHROPIC_API_KEY` を設定した環境で fixture を録り直すと落ちる。
落ちたら、従量課金の経路に切り替わっていないかを疑うこと。

---

## 15. 設定と汎用性（2026-09-07）

### 決め打ちを 3 種類に分けて扱う

| 種類 | 例 | 扱い |
| --- | --- | --- |
| **意図的に切った** | macOS 専用 / Claude Code 専用 / Forgejo と GitHub のみ | `docs/GOAL.md` の「やらないこと」。直さない |
| **他人の環境で壊れる** | Forgejo のパス、`brew`、探索先、remote 名 | `~/.izuna/config.json` で上書きできるようにした |
| **自分も踏むバグ** | `base: 'main'` の決め打ち、`origin/HEAD` | **検出に変えた**（下） |

### 置き場所が 2 つある（混同しやすい）

| 何 | どこ | 理由 |
| --- | --- | --- |
| 設定・共有フォルダ | `~/.izuna/config.json`、`~/.izuna/teams/` | 人が開いて編集するもの。見える場所に置く |
| **Forgejo のトークン** | **`app.getPath('userData')/forge-token.bin`** | `safeStorage` で暗号化する。人が触るものではない |

macOS の実体は `~/Library/Application Support/izuna/forge-token.bin`。
**`~/.izuna/` を見てもトークンは無い**（実際にここで一度間違えて
「未発行」と報告した）。`safeStorage` が使えない環境では**保管を拒む** ——
平文で置くくらいなら毎回入れてもらうほうがよい。

`userData` の名前は開発時が `package.json` の `name`（`izuna`）、
配布時が `electron-builder.yml` の `productName`（`Izuna`）で**食い違う**。
macOS の既定のファイルシステムは大小を区別しないので同じ場所になるが、
大小を区別するボリュームでは別扱いになる（**未検証**）。

### `~/.izuna/config.json`

無くても動く。**他の環境に合わせるための逃げ道**であって、用意しないと
使えないものではない。書式は `shared/config.ts`（純粋関数・検査済み）。

```jsonc
{
  "forgejoWorkPaths": ["/opt/homebrew/var/forgejo"],  // Docker なら [] にして下を書く
  "forgejoUrl": null,                                  // app.ini が読めないとき
  "sandboxRemote": "forgejo",                          // sandbox の remote 名
  "repoRoots": ["~/work", "~/src"],                    // 探索先
  "repoDepth": 3,
  "claudePath": null,                                  // PATH に無い場所に置いているとき
  "settingSources": ["project", "local"]               // §13
}
```

**壊れた設定でアプリを起動不能にしない。** 型の合わない値は既定に倒し、
**何を落としたかを名指しする** —— 黙って倒すと、直したのに効かない理由が
分からなくなる。設定画面の下に出る。

`repoDepth` は 1〜6 に制限する。ホーム全体を舐めさせない。

### 既定ブランチを決め打たない

`base: 'main'` と書いていた。`master` や `develop` のリポジトリで PR が
作れなくなる（**自分も踏む**）。`defaultBranch(cwd, remote)` に変えた。

1. `refs/remotes/<remote>/HEAD` を見る（ネットワークに出ない）
2. 無ければ `git remote show <remote>` に聞く
3. それでも駄目なら null。**`main` に倒さない**

`origin/HEAD` の決め打ちも同じ理由でやめ、検出した upstream の remote 名と
既定ブランチを組んで使う。

### まだ残っている決め打ち

- `brew install` / `brew services`（Homebrew 以外の導入方法）
- `/opt/homebrew/bin/claude` などのフォールバック（`claudePath` で回避可能）
- GitHub のホスト名一覧（GitHub Enterprise は未対応）

---

## 16. モックと実装の関係（2026-09-07 に改めた）

### 手書きの複製は必ずずれる

`design/` に画面のモックを描き、実装と手で同期していた。**同じ箇所を
逆向きに 2 回動かした** —— サイドバーのリポジトリ分けを「実装に合わせる」と
言ってモックから消し、あとで「モックに合わせる」と言って実装に足し直した。

共有フォルダで「**1 ファイル 1 書き手**」（§12）を設計しておきながら、
モックと実装という 2 つの表現を両方から書いていた。同じ間違いである。

### 決めたこと

**実装済みの画面はキャンバスに置かない。**

| 置くもの | 置かないもの |
| --- | --- |
| まだ作っていない画面 | 実装済みの画面 |
| 設計の決定と、その理由 | 画面の複製 |
| 不採用にした方向性（記録） | 色や余白の値 |

実物は `pnpm dev` で見る。決めたことは `Decisions.dc.html` と、この
`CLAUDE.md` に残す。

### やらなかったこと

- **`theme.ts` を CSS 変数に出してモックと共有する** ——
  色のずれは消えるが、**今回ずれたのは全部レイアウトと構成**だった。
  効果が薄いわりに仕組みが増える
- **実物のスクリーンショットをキャンバスに貼る** ——
  ずれないが撮る手間が要る。必要になってから

---

## 17. 見た目の土台（2026-09-07）

### 数えたら散らばっていた

| | 前 | 後 |
| --- | --- | --- |
| 部品の重複定義 | **13 箇所**（5 ファイル） | 0 |
| 文字サイズ | 9 種類（9 / 10 / 10.5 / 11 …） | **5 段** |
| 角丸 | 9 種類（2 / 3 / 4 / 6 / 7 …） | **3 段 + 丸** |
| gap | 14 種類 | **6 段** |
| 生の `#rrggbb` | 各所 | 0（`theme.ts` のみ） |

**意図した差ではなく、そのとき打った数字だった。** `BTN` を新しい画面で
コピペするたびに `padding` が `7px 15px` `8px 20px` `6px 16px` と違っていた。

モックと実装の二重管理（§16）と同じ間違いを、コンポーネント間でもやっていた。

### スケール

```ts
F  micro 10 / small 11 / body 12 / base 13 / title 15
R  sm 4 / md 7 / lg 11 / full 999
S  hair 2 / xs 4 / sm 6 / md 8 / lg 12 / xl 16 / xxl 24
```

### 部品は `components/ui.tsx` だけ

`Button`（primary / ghost / danger / quiet）・`Input`・`Card`（plain /
attention / active）・`Label`・`Faint`・`Tag`・`Dot`・`Meter`・`ellipsis`。

`danger` は破壊的な操作専用で、ほかと同じ形にしない。`attention` は
**人間の判断を待っているもの**だけ —— アンバーの規律（design/Decisions）を
部品の側に持たせて、使い方で外せないようにした。

### ネイティブの部品は既定が明るい（2026-09-08 に踏んだ）

`<textarea>` を塗り忘れて**真っ白**が出た。周りが全部暗いので、
そこだけ紙を貼ったように見える。原因は 2 つ重なっていた。

1. **`color-scheme` の指定が無かった。** これが無いと textarea / input の
   既定背景、チェックボックス、キャレット、スクロールバー、オートフィルまで
   明るいまま描かれる。`base.css` の `:root` に `color-scheme: dark` を置いた
2. **`ui.tsx` に `Input` があるのに、生の `<textarea>` を書いていた。**
   §17 で潰したはずの間違いを、別の形で繰り返していた

`TextArea`（`bare` で枠なし）と `Check`（ラベル付き）を `ui.tsx` に足し、
生のフォーム要素を全部寄せた。あわせて雛形が置いていった `--ev-c-*` を
20 個ほど落とした（**1 つも使っていなかった**）。読み込まれていない
`main.css` も消した。

### 塗り忘れても既定に落ちないようにする（三段）

インラインの `style` は**書いたものしか塗らない**。Tailwind を使っていれば
Preflight がフォーム要素を親から継承させるが、こちらは 294 箇所すべて
手で塗っているので、**塗り忘れが即そのまま既定（＝明るい）になる**。

そこで三段にした。**どれか一段が抜けても白くならない。**

| 段 | 中身 | 効く場面 |
| --- | --- | --- |
| 1 | `:root { color-scheme: dark }` | ネイティブ描画そのもの（キャレット・チェック箱・スクロールバー） |
| 2 | `input / textarea / select` を親から継承させる | **塗り忘れた要素**が黒く出る |
| 3 | `test/design-system.test.ts` の 2 件 | そもそも素で書かせない |

段 2 はチェックボックスとラジオを除く（`appearance` を殺すと箱が消える。
あちらは段 1 が面倒を見る）。`ui.tsx` の部品は背景も色も明示しているので、
継承より強く、影響しない。

**`<button>` は検査の対象にしない。** ModeSwitch のような形の違う部品があり、
「既定の見た目に落ちる」失敗の仕方をしない。ただし `S.send` / `S.btn` /
`S.ghostSmall` / `S.danger` のように、**App.tsx の中にボタンの定義が 6 つ残っている**
（Inspector と ModeSwitch にも各 1 つ）。§17 の穴はまだ塞ぎ切れていない。

### 門

`test/design-system.test.ts` がスケール外の値・部品の重複定義・生の色・
**生のフォーム要素・`color-scheme` の宣言**を検出して落とす。
**「とりあえず許可リストに足す」をしない。**
落ちたら値を直すか、スケール自体を見直す。

### `padding` も検査する（前言を撤回した）

ここには一度「`padding` は検査していない。多くは `ui.tsx` が吸収した」と
書いた。**数え直したら間違いだった** —— 44 通り残っていて、1〜24 のほぼ
全部の数字を使っていた。吸収されたのは一部で、「残りは個別の余白」という
のは確かめずに書いた言い訳である。

寄せる規則:

| 値 | 扱い |
| --- | --- |
| `0` | 「余白なし」の意思表示。寄せない |
| 1〜24 | `S` の最も近い段へ。同点なら**広いほう**（詰まって見えるより余る方がまし） |
| 25 以上 | 余白ではなく**配置**（モーダルを上から何 px 下げるか）。スケールに乗せず、8 の倍数に揃えてリズムだけ保つ |

結果は 27 通り・使う数字は 2 / 4 / 6 / 8 / 12 / 16 / 24 と 64 のみ。
モーダルの上げ底が 80 と 64 で食い違っていたのも、ここで見つかって揃えた
（意図した差ではなかった）。

---

## 17.5 入口で作文を強制しない（2026-09-08）

「新しいセッション」で**やることを書かないと「起こす」を押せなかった**。

理由はあった。**ブランチ名をやることから作る**設計にしたので（人に worktree を
作らせないため）、やることが空だとブランチが決まらず worktree を作れない。
それで入力を必須にしていた。

**が、それは「とりあえず開いて、会話で伝える」を潰す理由にならない。**
道具の入口で作文を強制していた。指摘されるまで気づかなかった。

切り分け直した。

| やること | 起きること |
| --- | --- |
| 書いた | ブランチ名を起こして worktree を作り、その文をそのまま最初の依頼として送る |
| 書かない | **リポジトリでそのまま開く。** 何も送らない。会話の入力欄から始める |

**worktree は「名前の付く仕事」があるときだけ。** 名前の無い worktree は
一覧で意味を持たないので、無理に作らない。

一般化すると —— **設計上の都合（ブランチ名が要る）を、利用者への要求
（作文しろ）に変換していた。** 制約が満たせないときは、要求を増やすのではなく
機能を降ろす（worktree を作らない）ほうを既定にする。

---

## 18. セッションの保存は自作しない（2026-09-07 実測）

### 気づいていなかったこと

「セッション保存の機能が無い」と思っていた。**間違いで、既に保存されている。**
`claude` は 1 セッション 1 ファイルで JSONL を書いている。

```
~/.claude/projects/<cwd のスラッグ>/<session-id>.jsonl
```

**Izuna が起こしたセッションも既に落ちていた**（`-private-tmp-izuna-probe`、
`…-T-izuna-cwd-*` など 7 本）。Izuna が知らなかっただけである。

この会話（19MB・6,000 行超）の実測:

| 種別 | 件数 | 使い道 |
| --- | --- | --- |
| `assistant` / `user` | 963 / 463 | 会話の復元 |
| `ai-title` | 366 | **CLI が付けた題名**。一覧のラベルが只で手に入る |
| `slug` | — | `happy-jingling-cherny` 形式のコードネーム（2.1.x） |
| `mode` / `permission-mode` | 各 367 | 復元時のモード |
| `file-history-snapshot` | 49 | ファイル編集のスナップショット |
| `attachment` | 2,540 | 途中で足された文脈（ツール追加・スキル一覧） |
| `last-prompt` / `queue-operation` | 367 / 40 | 直近プロンプトの栞・投入キュー |

サイドカーが 2 種類ある（このマシンには未出現・**未検証**）。

```
<sessionId>/subagents/agent-<id>.jsonl   実行役の記録
<sessionId>/tool-results/                外に出したツール結果
```

**`subagents/` が存在するなら、§12 の「まだ測っていないこと」の一部は
ファイルを読むだけで解ける。** 実行役を 1 本走らせて確かめること。

### 実装して分かったこと（2026-09-07）

**1. 人間の発話は素性で判定できない。**
最初 `origin.kind === 'human'` で判定して間違えた。CLI から打ったものには付くが、
**SDK 経由 —— つまり Izuna 自身が起こしたセッションでは `origin` が `null`**
（`promptSource: "sdk"` / `entrypoint: "sdk-cli"`）。
**一番見たいセッションだけ見出しが出ない**という形で出た。

素性ではなく**中身の形**で判ぐ。ツール結果を含まない `user` が発話である。
`test/sessions.test.ts` に回帰の門を置いた。

**2. 記録に思考は残っていない。**
`thinking` ブロックは 301 件すべて本文が空で、`signature` だけが残っていた。
CLI が保存時に落としている。そのまま復元すると**空の箱が数百個並ぶ**ので、
`replay` で捨てる。**復元した会話に思考は戻らない**（戻せない）。

**3. CLI が差し込んだ本文が見出しに漏れる。**
`<local-command-caveat>`（圧縮の注記）と `<command-name>`（スラッシュコマンドの
展開）。`isMeta` が付くものと付かないものがあるので、印だけに頼らず本文の頭も見る。

**4. 全文を読まない。** 一覧は頭と尻尾 64KB だけ読む。`cwd`・最初の発話・版は頭に、
`ai-title` と `slug` は尻尾にある。実測 45 件で **16ms**。
全文を読むのは復元のときだけ（19MB・6,922 行 → 495 item で 51ms）。

**5. 復元は main でやる。** 行のまま renderer に渡すと 19MB が IPC を通る。
`replaySession` は組み立て済みの `Transcript` を返す。

### 置き場所

```
src/shared/sessions.ts   要約・見出し・絞り込み・復元（純粋関数）
src/main/sessions.ts     ~/.claude/projects の走査。頭と尻尾だけ読む
test/sessions.test.ts    門 21 件。入力は**録画ではなく手で書いた**（§11 と同じ理由）
```

UI は**新しいツールバーを足していない**。`NewSession` の中に「続きから」を置いた ——
人が選ぶのは「新しく始めるか、続きか」であって、履歴という別の画面ではない。

### 決めたこと

**保存層を自作しない。走査する。** 理由は 3 つ。

1. 二重に持つと必ずずれる（§16 と同じ間違いになる）
2. ターミナルの `claude` で起こしたセッションも Izuna から見える
3. `ai-title` と `slug` があるので、題名を自前で生成しなくてよい

Nimbalyst も同じことをしている（`ClaudeCodeSessionScanner.ts`。コメントに
"discovers sessions created by the Claude Code CLI **or other tools**"）。

走査とパースは `shared/` の純粋関数に置く（§4 の原則）。**実 API が要らないので
門が作れる。** fixture は自分の `~/.claude/projects` から 1 本切り出す ——
ただし §11 と同じ理由で、**素の記録は私的な内容を含むので commit しない**。

### なぜこれを先にやるか

Izuna で Izuna を作ると、**直したものを見るのに必ず一度アプリを落とす**
（renderer は HMR、main は入れ替わらない。§7）。セッションが復元できないと
落とすたびに全部消えるので、dogfood の前提が成立しない。

---

## 19. Nimbalyst 再調査（2026-09-07）

TS/TSX 約 5 万行、`packages/electron` だけで 3,066 ファイル。
**機能で追う相手ではない**（§2 の結論は変わらない）。取捨を明示しておく。

| 機能 | Izuna |
| --- | --- |
| セッション一覧・resume・検索・Kanban | **取る**（§18） |
| セッション ↔ ファイルの相互リンク | 取る |
| 赤緑の差分を **1 件ずつ** accept/reject | 取る（いまの差分ビューは表示のみ） |
| AI によるコミット文の下書き | 取る |
| MCP の結果を JSON でなく widget で描く | 保留 |
| **15 の agent provider 抽象**（Codex / Copilot / Cursor / Gemini …） | **取らない**。Claude Code 専用は §15 の意図的な決定 |
| 視覚エディタ 7 種（Mermaid / Excalidraw / データモデル …） | **取らない**。別の製品 |
| 拡張 SDK とマーケットプレイス | **取らない**。利用者は作者ひとり |
| iOS companion・push 通知 | **取らない**（GOAL.md） |
| リアルタイム共同編集・セッション共有 | **取らない** |

参考になった実装:

```
packages/electron/src/main/services/ClaudeCodeSessionScanner.ts   JSONL 走査
packages/electron/src/main/services/ClaudeCodeSessionSync.ts      索引との同期
packages/runtime/src/ai/server/providers/TeammateManager.ts       §12 で既出
```

---

## 20. リポジトリと公開範囲（2026-09-08）

upstream は **private** の `Watakumi/izuna`（remote 名も `upstream`）。
`shared/remote.ts` はホストで役を決めるので、`github.com` は自動で upstream になる。
sandbox（Forgejo）はまだ無く、`stageOf` は `needsSandbox` を返す。

### 公開前に監査した結果（全リビジョン対象）

| 見たもの | 結果 |
| --- | --- |
| 認証情報（`sk-ant-` / `ghp_` / `github_pat_` / 秘密鍵 / 40桁hex） | 0 件 |
| メール・実名・会社名 | 0 件 |
| `session-full.ndjson`（私的な会話を含む録画） | 履歴にも一度も無い |
| 録画の会話本文 | 疎通用の合成のみ（`pong` / `hello izuna`） |

トークンは `~/.izuna` の `safeStorage` にあり、リポジトリの外。

### **これは「あとで public にできる」状態ではない**

private の範囲には収まっているが、**履歴に入っている**ものが 3 つある。
公開したくなった時点では `git filter-repo` で書き換えるか、作り直すことになる。

1. **環境の指紋**（`test/fixtures/*.ndjson`）——
   `~/.claude/plugins/cache/…/1.10.0`、`slash_commands` 52 件の全リスト、
   `messaging_socket_path`（PID 由来）。**アカウントがどの機能を使えるかが分かる**
2. **コミットの著者メール**（個人の Gmail）が全コミットに入っている
3. **§14 の口座の話** —— Pro プラン、`five_hour 3% / seven_day 5%`、
   自宅 Forgejo の `localhost:4649`、別リポジトリ名

**fixture を先回りして加工しない。** §11 で「加工した時点で観測ではなく解釈になる」
と決めてある。private のうちは触らないほうが原則に合う。
公開するなら、そのとき fixture を**録り直す**（削るのではなく）。

---

## 21. 見た目を Ghostty から借りる（2026-09-08）

ターミナルは既に ghostty-web で動いているのに、**アプリの色だけ別**だった。
利用者が自分で決めた配色があるなら、それに合わせるほうが筋が通る。

### 読む順

```
~/.config/ghostty/config        （XDG_CONFIG_HOME があればそちらが先）
  theme = notion   →  ~/.config/ghostty/themes/notion      ← 利用者の自作を先に見る
                      /Applications/Ghostty.app/.../themes/notion
```

**利用者の置き場を先に見ること。** 実測で `theme = notion` は同梱ではなく
**自作**だった。同梱を先に見ると、同名の自作テーマが黙って無視される。
重ね順は Ghostty と同じで、**テーマを敷いてから設定ファイル本体で上書き**する。

### 割り当て —— 係数ではなく**コントラスト比**で決める

最初は「地から 0.66」のような係数で段階を作った。**指摘されて測ったら薄すぎた。**

| | 前 | 後 |
| --- | --- | --- |
| `ink2`（本文） | 8.9（利用者の文字色を 12% 薄めていた） | **11.2 = 文字色そのまま** |
| `dim` | 5.5 | 8.0 |
| `dim2` | 3.9 | 6.0 |
| `faint` | **2.4** | **4.5** |
| `line`（枠） | 1.3（ほぼ見えない） | 1.6 |

**係数はテーマによって意味が変わる。** 地と文字の差が小さいテーマでは、
同じ 0.66 でも読めない色になる。読めるかどうかは**比**で決まるので、
`atContrast()` が二分探索で目標の比になる色を返す。

2 つ、間違えていた点がある。

1. **利用者が選んだ `foreground` を、更に薄めて本文にしていた。**
   `#cfcecc` は「純白を使わないと目が楽」として本人が選んだ色である。
   それを 12% 地に寄せる理由が無い。**本文は文字色そのもの**にし、
   強調は色ではなく**字の太さ**で付ける（Notion 自身がそうしている）
2. **`faint` を装飾扱いしていた。** 数えたら **10px の字に 13 箇所**
   使っていた（キーヒント・時刻・補助ラベル）。情報を持っているので
   AA（4.5）を割らせてはいけない

**既定のテーマも同じ欠陥を持っていた**（`faint` が 2.3）。Ghostty 対応で
持ち込んだものではなく、目分量で置いた最初からの間違いだったので、
既定側も同じ目標で引き直した。

`test/ghostty.test.ts` の「読む字が AA を割らない」が門。

混ぜる向きを「地 → 文字」に統一してあるので、**明るいテーマでも暗いテーマでも
同じ式で通る**。利用者が低コントラストの文字色を選んでいる場合は、
**目標に届かなくてもその色より濃くしない**（選択を尊重する）。

| トークン | 由来 |
| --- | --- |
| `bg` / `ink` | `background` / `foreground` そのまま |
| `surface` / `raised` / `line` / `dim` … | 地と文字を混ぜて段階を作る |
| `panel` / `code` | 地を更に黒（明るいテーマなら白）へ寄せる |
| `amber` | palette 11 →3（黄） |
| `teal` | palette 14 →6 →12 |
| `red` | palette 9 →1 |
| `amberInk` | 黄の上に載せて**読めるほう**を地と文字から選ぶ（WCAG の比） |

**役割は変えない。** アンバーは「人間の判断待ち」のままで、当てる色だけが
変わる（§17 の規律）。`background` か `foreground` が読めなければ **null を返し、
既定の色のまま出す** —— 中途半端に当てるより既定のほうがよい。

等幅フォントも借りる（実測では `JetBrainsMono Nerd Font`）。

### 使う側を書き換えずに差し替える

`theme.ts` の `C` は `var(--c-bg, #14161b)` の形にした。**使う側 294 箇所は
1 つも書き換えていない。** 変数が無ければ既定が出るので、Ghostty が無い環境でも
そのまま動く。当てるのは `applySkin()` が `:root` に変数を置くだけで、
React の再描画も要らない。

### まだやっていない

- **ターミナル（ghostty-web）自身にテーマを渡していない。** アプリの色は
  合ったが、ターミナルの中はまだ既定のまま
- `background-opacity` / `background-blur` は見ていない（Electron 側の
  窓の設定が要る）
- 設定を変えたときの再読み込み。いまは起動時に 1 回だけ
