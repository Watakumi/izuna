---
paths:
  - "src/main/claude/**"
  - "src/main/hub.ts"
  - "src/shared/transcript.ts"
  - "scripts/**"
  - "test/main-session.test.ts"
  - "test/main-hub.test.ts"
  - "test/auth.test.ts"
  - "test/scripts-protocol.test.ts"
---

# claude の駆動

SDK の `query()` で claude を飼うときに要る実測。ワイヤ形式、承認の握手、設定の読み込み範囲、課金。

## 5. stream-json 実測仕様

**すべて `claude 2.1.263` での実測（2026-09-10 に `2.1.266` で fixture を録り直し、同じ形で通ることを見た）。公開仕様ではない。CLI が上がったら測り直す。**

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

---

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

### 金額は出さない。**「使用量」とも書かない**

`costBasis: "list"` は定価換算であって請求額ではない。そのまま `$0.0145` と
出すと課金されているように読めるので、**金額そのものを消した**。

ところが言葉のほうで戻してしまった。上限の割合に**「使用量」**という
見出しを付けたが、**「使用料」と一字しか違わず**、金額を出していると読める。
消したはずのものを、別の形で置き直していた。

いま出しているのは `5時間 31%` だけ ——
**上限に対する割合であることが、単位から読める形**にした。

### これを壊さないための門

`test/auth.test.ts` が `apiKeySource` を検査している。
`ANTHROPIC_API_KEY` を設定した環境で fixture を録り直すと落ちる。
落ちたら、従量課金の経路に切り替わっていないかを疑うこと。

### 鍵は渡さない（2026-09-08、docs/NIMBALYST.md §3 の 1）

ログインシェルの環境を claude に渡す前に、`shared/billing.ts` が `ANTHROPIC_API_KEY` と
`ANTHROPIC_AUTH_TOKEN` を落とす。無関係の作業のために rc に置いてある鍵を拾うと、
**黙って従量課金に切り替わる**（Nimbalyst は同じ形で利用者の個人口座に 100 ドル超を請求した）。
`test/auth.test.ts` は録画を見るだけで実行時には守っていなかった。落としたときは main のログに出る。

### `AskUserQuestion` は問いとして描く（2026-09-08、docs/NIMBALYST.md §3 の 2）

SDK ではこれも `canUseTool` に来る。`shared/question.ts` が入力を問いに読み、
`components/Questions.tsx` が選択肢と「その他」の自由記述を描く。答えは
`{ behavior: 'allow', updatedInput: { ...input, answers: { [question]: label } } }` で返す。
**`answers` の鍵の形は CLI の実装から読んだもので未検証。** 違っていれば
エージェントが「答えが無い」と言うので分かる。全部に答えるまで送れない ——
途中で送ると、答えの無い問いが拒否に見える。
