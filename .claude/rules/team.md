---
paths:
  - "src/main/team.ts"
  - "src/shared/team.ts"
  - "src/main/hub.ts"
  - "src/main/loop.ts"
  - "templates/**"
  - "src/renderer/src/components/Board.tsx"
  - "src/renderer/src/components/TaskPanel.tsx"
  - "test/team.test.ts"
  - "test/main-team.test.ts"
  - "test/teammate.test.ts"
---

# ブレインと実行役

共有フォルダの形と規律、盤面、並列の衝突判定、worktree を作らない判断。

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
pathCollisions(tasks)   // 走っている（doing / idle）同士で、同じ場所を触りうる組
readyTasks(tasks)       // 依存が満たされ、未着手で、走っているものと重ならないもの
```

重なりは完全一致ではなく**区切り単位の接頭辞**で見る（ディレクトリとその中のファイルは重なる。
`./` と末尾の `/` は同じ扱い。2026-09-08 に直した。それまでは完全一致だった）。

**これは助言であって強制ではない。** 実行役を起こすのはブレインで、Izuna ではない。
`pathCollisions` は両方が走ってから鳴る事後の検出、`readyTasks` は重なるものを
「いま着手できる」に出さないという事前の絞り込みで、どちらも止めはしない。
通しているのは `main/team.ts` の `readBoard()` で、右パネルの「盤面」が出す。
**申し送りに規律を書くだけでは通らない** —— 書いてある規律は、
守られたかどうかを誰も見ていない。`test/docs.test.ts` はこの形
（文書が機能として書いているのに製品コードが呼んでいない）を落とす。

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

### 実測（2026-09-09）—— 実行役 2 つを並走させ、hook と追加指示を測った

`scripts/probe-team.ts`（実 API を呼ぶ。`--isolation` で方式を切り替える）。一時リポジトリで
ブレインを起こし、背景の実行役 2 つ（alpha / beta）にファイルを書かせて commit させた。
結果は `scripts/probe-team*.result.json`（gitignore）に残る。

| 問い | 答え |
| --- | --- |
| 実行役（サブエージェント）は `EnterWorktree` を呼べるか | **呼べない。** 「EnterWorktree cannot create a worktree from a subagent with a cwd override … spawn an Agent with `cwd` set to it」と「cwd is the repository root, not an isolated worktree」の 2 通りで拒まれ、実行役は `git worktree add` に逃げた |
| ではどう分けるか | **`Agent` ツールに `isolation: "worktree"` を付ける。** worktree は `<project>/.claude/worktrees/agent-<id>`、ブランチは `worktree-agent-<id>`。2 つとも自分の worktree に commit し、**本体の作業ツリーと HEAD は無傷**だった |
| SDK の `hooks` で鳴るもの | **`SubagentStart` と `SubagentStop`** だけ（`agent_id` 付き。Stop は `last_assistant_message` を持つ）。`TeammateIdle` / `TaskCreated` / `TaskCompleted` は鳴らなかった（サブエージェントはチームメイトではない） |
| **`WorktreeCreate` を張るとどうなるか** | **Agent の起動が失敗する。** あれは観察の口ではなく作成を委ねる口で、hook が `worktreePath` を返さないと「hook succeeded but returned no worktree path」で spawn ごと落ちる。Izuna は張らない（`shared/teammate.ts`） |
| 実行役の承認は誰に来るか | host（人）に `agentID` 付きで来る（2026-09-07 の再確認） |
| 実行役が止まったあと、ブレインは続けるか | 続ける。`task_notification` が届き、ブレインが目を覚まして返事をする |
| ブレイン → 実行役の追加指示は届くか | **届く。** `SendMessage` に実行役の id を渡すと「Resuming agent …」で止まっていた実行役が起き、追記して commit し、また `SubagentStop` が鳴った。同じセッションの中なので `crossSessionInbound` の保留は起きない |

**決めたこと。** `teamInstructions` に起こし方を書く（`isolation: "worktree"`、`EnterWorktree` は
呼ばせない、追加指示は `SendMessage`）。hook は `SubagentStart` / `SubagentStop` を主に見て、
`TeammateIdle` / `Task*` は鳴れば拾う。鳴らないものを画面に約束しない。

### まだ測っていないこと

- `TeammateIdle` / `TaskCreated` / `TaskCompleted` が鳴る条件（`teammateMode` で
  チームメイトとして起こしたとき、と思われる。Izuna はサブエージェント方式なので急がない）
- `teammateMode` ごとの挙動差
- ~~agent isolation を有効にしたときの worktree の実際の置き場所~~ → **測った（上）**
- ~~`EnterWorktree` を実行役（サブエージェント）が呼べるか~~ → **呼べない（2026-09-09）**
- ~~`SendMessage` の宛先解決~~ → **実行役の id で届く（2026-09-09）**
