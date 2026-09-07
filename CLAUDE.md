# Izuna

Claude Code を Codex のようにデスクトップから使う macOS アプリ。

このファイルは**単独で読めるコンテキスト**として書いてある。会話履歴を持たない
エージェントがこれだけ読んで作業を継続できることを目指す。事実と、その根拠に
なった実測を残す。推測は「未検証」と明記する。

- リポジトリ: `~/work/personal/izuna`
- **何を作るかは [docs/GOAL.md](docs/GOAL.md)。** このファイルは*どう*作るかを書く
- 画面設計: https://claude.ai/code/artifact/873094d6-cdf6-46b4-b488-a69ab9e3641e （元ファイルは `design/`）
- 現状: セッション層（Agent SDK 経由）+ 権限承認の握手 + 検証の土台まで。UI は未着手
- **`pnpm verify` は緑**（14件）。壊したら直してから進むこと
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

**libghostty は `ghostty-web` で使う（2026-09-07 に方針変更）。** 当初は
「Electron から使う道が細い」と判断して見送ったが、Nimbalyst のソースを読んで
実用経路が判明した。`ghostty-web`（coder 製）は **libghostty-vt の公式 WASM
ビルド**で、xterm.js 互換 API・Canvas レンダラ・Kitty graphics・OSC 8 を持つ。
Nimbalyst は `ghostty-vt.wasm` を同梱し `node-pty` と組み合わせている。
当初の企画趣旨（libghostty を使う）はこれで果たせる。段 5 で入れる。

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
- **pnpm 11 は `allowBuilds` を埋めるまで install を拒む**。`pnpm-workspace.yaml` が
  雛形のまま(`set this to true or false`)だったので、`pnpm verify` が**起動もしなかった**。
  `package.json` の `pnpm.onlyBuiltDependencies` は 11 では読まれない(移設先が workspace 側)

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
5. 中断（`interrupt_receipt_v1`）の使い方。
   **いまの `ClaudeSession.interrupt()` は子プロセスに `SIGINT` を送っている。**
   コメントは「プロセスは生かしたまま」だが、1 プロセス = 1 会話なので
   会話ごと落としている可能性がある。`capabilities` に中断の制御プロトコルが
   出ているのだから、本来はそちらのはず。**測っていない**
6. 異常系: プロセス死、認証切れ、CLI 更新でワイヤ形式が変わったとき
   → 6 のうち「CLI 更新」だけは §11 で塞いだ。残りは未着手
7. **プラグイン hook の遮断手段**（§7 の新しい罠）。
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

### まだ測っていないこと

- `TeammateIdle` hook が Agent SDK 経由でも発火するか
- `SendMessage` の宛先解決（`ListAgents` が返す名前の形）
- `teammateMode` ごとの挙動差
- 実行役が承認を求めたとき、それがブレインに行くのか人間に行くのか
  （**ここは人間に来てほしい。GOAL.md の完成の定義 5**）
