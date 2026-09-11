---
paths:
  - "test/**"
  - "vitest.config.ts"
  - "harness/**"
  - "scripts/**"
  - ".githooks/**"
---

# 検査

完了の条件、検証の土台、文書と実装のズレの門、測っていない場所の減らし方。

## 10. 完了の条件

```bash
pnpm verify     # typecheck + lint（警告 0）+ test + カバレッジ。緑にならないものを完了としない
pnpm shots      # 画面を描いて撮って測る（§22）。ブラウザが要るので verify には入れない
```

lint は 2026-09-10 から verify の中（§27）。`eslint-disable` を置くときは理由を同じ行に書く ——
置いてあるのは、await の後で setState する effect（`react-hooks/set-state-in-effect` が同期と区別しない）、
ANSI の制御列を探す正規表現、型の無い `.js` / `.mjs` の 3 種だけ。

### カバレッジ（2026-09-08 に入れた）

**下回ったら落ちる。** 線は範囲ごとに `vitest.config.ts` にある（§28）。数えるだけでは戻る。

| | |
| --- | --- |
| `shared/` + `main/` | **行 98.0%、分岐 88.0%**（2026-09-08）。線は行 97、分岐 84 |
| `renderer/src/components/` | **行 94.1%、分岐 88.8%**（2026-09-11。`TerminalPane` を数えなくなった分だけ上がった）。線は行 92、分岐 86 |
| **ファイルごとの床** | shared + main は 行 85 / 関数 70 / 分岐 70、renderer は 行 70 / 関数 60 / 分岐 60（2026-09-11） |

### 合計の線だけでは検知できない（2026-09-11）

範囲の合計が上回っていても、1 ファイルが落ちていることがある。`main/forge/setup.ts` の分岐が 78% でも
門は緑だった（利用者の指摘）。`vitest.config.ts` の `perFile` で**ファイルごとの床**も引いた。
床は一番低いファイルの実測から決めてあり、下回ったファイルが名指しで出る
（「Coverage for lines (89.4%) does not meet per-file threshold for src/main/git/remote.ts」の形。
床を 99 にして落ちることを確かめた）。合計の線は範囲の平均、床は最低。両方守る。

床を引くために 2 つ直した。`shared/wait.ts` の `if (timer)` は executor が同期に走るので到達しない枝で、
消した。`main/claude/status.ts` は `--version` が落ちる・`auth status` が空の枝を検査していなかった。
`TerminalPane` は ghostty-web の WASM を jsdom で起こせないので `include` から外した（`pnpm shots` が見る）。
0 のまま数えると renderer の床が引けない。

**数えるのは検査できるものだけ**（`vitest.config.ts` の `include`）。
Electron の起動（`index.ts`）と口の表（`ipc/register.ts`）は外す —— 判断は
`main/hub.ts` に出してあり、そちらを数える（§28）。線は範囲ごとに引く。
画面の部品は jsdom で描いて数え、見た目は `pnpm shots` が別に見る。

### 外の道具を呼ぶ層は「渡している引数」を見る

`forgejo` / `brew` / `gh` / `git` / PTY / Agent SDK は差し替えるが、
**渡している引数を必ず見る**。模造を置いて戻り値だけ確かめると、
**引数が間違っていても通る検査**になる。

固定してあるもの（抜粋）:

| | |
| --- | --- |
| `setup.ts` | `--scopes` に `write:user` が入っていること（無いと 403）。**書き換える前に控えを残す**こと |
| `session.ts` | `systemPrompt` の preset（§7 の最大の罠）、承認の fail-closed |
| `remote.ts` | **トークンを引数に置かない**（`ps` で見える）。`credential.helper` を止めること |
| `terminal.ts` | 閉じた窓に書き込まないこと、まとめて閉じられること |
| `locate.ts` | ログインシェルに `-ilc` で聞くこと、NUL 区切りで環境を読むこと |

### `session.ts` は SDK を差し替えて測る（97.4%）

ここだけは模造を置いた。ただし**渡している引数を必ず見る**ようにしてある ——
一番大事なのは「何を渡しているか」であって、SDK の動作ではない。

固定したもの:

- **`systemPrompt` に `claude_code` の preset を渡している**こと
  （§7 の最大の罠。省くと**居場所を知らないまま作り話をする**）
- `settingSources`（§13）、`forwardSubagentText`、`includePartialMessages`
- `pathToClaudeCodeExecutable` とログインシェルの環境（§7）
- `send()` が `origin: { kind: 'human' }` を付けること
- **承認の fail-closed**（中断されたら deny、終了時に未応答を deny で畳む）
- **返らない片付けで止まらない**こと（§7「終われないアプリよりまし」）
- 入力の待ち行列 —— 読み手が待っているところへ届くか、終了で起こされるか

### 検査を書いて分かったこと

**3 つ、実装の粗さが見つかった。**

1. 記録の読み出しが、走査先の無い環境で `ENOENT` を投げていた
   （`scanSessions` は空を返すのに）
2. `removeWorktree` がパスを**文字列で照合**していた。macOS の `/var` は
   `/private/var` への symlink で、git は解決後の絶対パスを返す。
   `WorktreeCreate` フックが返すパスでも起きうる
3. `github.ts` の検査を書くとき `loginShellEnv()` が先に `execFile` を
   消費することに気づいた —— 呼び出しの順序が見えていなかった
   （2026-09-08 に `loginShellEnv` は一度取ったら覚えるようになった。§27。
   検査は `locate` を差し替えているので、順序の問題は消えている）

補助（どちらも**実 API を呼ぶ**ので、verify には入れていない）。

```bash
pnpm install
npx tsx scripts/smoke-session.ts    # いま CLI と話せるか。人が目で見る
npx tsx scripts/record-fixture.ts   # そのとき CLI が何を吐いたかを録る
pnpm dev                            # 足場の起動確認（UI はテンプレートのまま）
```

`pnpm verify` が「手元の claude は X、実測は Y」で落ちたら、CLI が上がっている。
**`pnpm run catchup`** が順番どおりにやる（2026-09-10）: 同じ番号の SDK が熟成の線（§27）を越えていれば
入れ、fixture を録り直し、`MEASURED_CLI_VERSION` と CLAUDE.md の版を上げ、verify を回す。
越えていなければ、いつ越えるかを言って止まる。`--check` は言うだけで何も変えない。
**定数だけ先に上げると、検査は緑になるが中身は測っていないことになる**ので、手でやらない。

**最新を追う口は `pnpm run upstream`**（2026-09-11。道具の性質上、claude と Forgejo の最新は追うと決めた）。
測った版と npm の最新（SDK 0.3.N ↔ CLI 2.1.N）を比べ、間の CHANGELOG（anthropics/claude-code）を出し、
SDK が熟成の線を越える日を言う。Forgejo は Codeberg の releases から同じ系列の最新と全体の最新。
週 1 回 CI でも回す（`.github/workflows/upstream.yml`）。**読むだけで何も変えない** —— 上げるのは人。
読んで Izuna に効くものがあれば、docs/ORCA.md と同じ形で「取る／取らない」を書いてから入れる。

---

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
| パースを **プロセスから切った純粋関数に出す** | `spawn` に密着していると、CLI を叩かないと何も検証できない |
| **録画した NDJSON を版管理に入れる** | 網も費用も要らない検査ができる。加工しない —— 加工した時点で観測ではなく解釈になる |
| 版のずれは **verify で落とし、アプリでは落とさない** | 版が上がってもワイヤが変わるとは限らない。**上がるたびに起動しない道具は使われなくなる**。止める代償が安いのは verify の側 |
| fixture 未録は **skip ではなく赤** | skip する検査は門ではない。赤が「まず録れ」の合図になる |
| fixture は **2 本録る**（2026-09-07 追加） | 素で録ると hook が過去セッションの要約（私的な会話内容）を注入し、そのままでは commit できない。**後から削るのは「加工しない」に反する**ので、代わりに観測条件を統制する。`--safe-mode` の safe 版を commit し、full 版は gitignore |
| full 版の検査だけは **skip してよい** | 「まだ録っていない」ではなく「**設計上 commit しない**」ものだから。門の役は safe 版が負う |

### 配るので、録画から家のパスを伏せる（2026-09-09）

「加工しない」（上の表）に 1 つだけ例外を置いた。**`/Users/<名前>` を `/Users/someone` に置き換える。**
識別子だけで、行の形も中身も変えない。理由は配ること（DECISIONS §20）——
録画には cwd・プラグインの置き場・ソケットのパスとして家のディレクトリが入る。
`scripts/record-fixture.ts` と `scripts/record-transcript.ts` が書き出すときに機械的にやるので、
録り直しても手で伏せる作業は無い。あわせて `record-fixture.ts` は cwd を一時ディレクトリにし、
`DISABLE_AUTOUPDATER=1` で録る（native の claude は走るたびに自分を更新する。§7）。
2026-09-09 に既存の 3 本（safe / transcript-teammate / transcript-tools）にも同じ置換を当てた。
古い中身は履歴から消した（DECISIONS §20）。

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

## 24. 文書と実装のズレの門（2026-09-08）

### なぜ入れたか

Nimbalyst に `SafePathValidator` というパス検証器がある。設計文書には
安全機構として書かれ、専用の検査もある。**製品コードからは一度も呼ばれていない** ——
と 2026-09-08 の朝に読んだが、同日の main（`49220e4b`）では
`ElectronFileSystemService` が `validate()` を 3 か所で呼んでいる（`docs/NIMBALYST.md` §5）。
読んだ時点が違ったか、読み違えたか。**門の理由は変わらない**（この形は起きうる）が、
根拠として Nimbalyst を挙げるのはやめる。
同じリポジトリのセキュリティ文書は `permissionEngine.ts` /
`dangerousPatterns.ts` / `directoryScope.ts` を対策として挙げているが、
**そのファイルは存在しない**。

**検査は通り、文書は立派で、コードは呼んでいない。**
これは「守られていない」より質が悪い。**守られていると思い込ませる**からである。

他人事ではないので、Izuna で同じ形を探した。`test/docs.test.ts` がその門で、
入れた日に **27 件**出た。

### 何を見ているか

| 門 | 落とすもの |
| --- | --- |
| 名指ししたファイルが実在する | CLAUDE.md が書いたパスが消えている／移動した |
| **公開した値が製品コードから呼ばれている** | 検査だけが呼んでいる export（＝ SafePathValidator の形） |
| `§N` の参照が見出しとして実在する | 節を足し引きしたときの番号のズレ |
| 「やらない」が守られている | worktree を作らない、トークンを URL に埋めない |

Izuna は library ではない。**外部の利用者という逃げ道が無い**ので、
呼ばれない export は作りかけか置き忘れのどちらかである。
逃げ道を作らないために、許可リストは置かなかった。

### 27 件の内訳と、何をしたか

| 区分 | 件数 | 対応 |
| --- | --- | --- |
| 道具だけが使う（`scripts/` `harness/`） | 8 | **`src/` の外へ出した**。`protocol.ts` を `scripts/` へ |
| 検査の都合で置いていた組み立て | 2 | 検査ファイルの中に移した |
| 作りかけ・置き忘れ | 8 | 消した（`extractMessage` `saveConfig` `isRepo` ほか） |
| **文書が保証として書いていたのに動いていない** | 9 | **繋いだ**（`shared/team.ts` の盤面一式） |

### 消す前に、必ず `src` の外も見る

最初に `protocol.ts` を「SDK 移行の置き忘れ」と判断して消しかけた。
実際には `scripts/record-fixture.ts` が使っており、**録画の道具が壊れるところだった**。

`src` の中だけを見て「誰も使っていない」と言うのは、
**調べていないことの証拠にしかならない**（§10 と同じ規律）。
判定は `src` `test` `scripts` `harness` の 4 つを全部見てから下す。

### 移動は依存の申告である

`scripts/protocol.ts` は消すのではなく移した。
`src/` に置いたままだと「アプリが使っている」ように見え、
上流の CLI が変わったとき壊れる範囲を読み違える。
**置き場所そのものが、誰が依存しているかの申告**になっている。

### 2026-09-11 に足した門（docs/ORCA.md §7）

| 門 | どこ | 落とすもの |
| --- | --- | --- |
| 自己紹介は 1 文 | `test/docs.test.ts` | package.json の description、README と CLAUDE.md の 1 行目が違う（3 通りに割れていた） |
| 画面の言葉 | `test/copy.test.ts` | ui.md §17.4 で消した語が renderer と shared の文言に戻る。註は見ない |
| 握りつぶした例外 | `test/ratchet.test.ts` | `.catch(() => null)` と空の `catch {}` が `test/fixtures/swallowed-catches.json` より増える。減ったら baseline を下げるまで落ちる（Orca の ratchet と同じ形） |

### 直せなかった種類のズレ

この門はパスと識別子しか見ない。**説明文の正しさは見ていない。**
実際、§4 の「まだ無い: renderer の実装、IPC 登録、`/` コマンドの索引、権限承認」は
4 つとも既にあった。門に落ちなかったのは、そこに識別子が無いからである。
**機械が読める形で書いたものしか守れない**ということは、書く側が知っておく。

---

## 28. 測っていない場所を減らす（2026-09-08）

カバレッジは行 97.8% だったが、**測っていた範囲**が全体の 6 割だった。
`src/renderer` の 3,762 行は対象外で、`register.ts` の 330 行は「登録だけ」の建前で除外されていた。
建前に反して、ループの反復・起床の配送・レビュー依頼の組み立てがその中にあった。

### 駆動部を `main/hub.ts` に出した

`SessionHub` が走っているセッションを **1 件 1 record**（session・共有フォルダ・cwd・ループ）で持つ。
以前は同じ id で引く Map が 4 本あり、片方だけ消して片方が残る形だった。
`register.ts` は口を関数に繋ぐ表だけになり、`Handlers` の型が
**口の数だけ手があること**を型検査に見させる（1 つ欠けても余っても落ちる）。

`test/main-hub.test.ts` は claude・git・関所を差し替え、ループと予約は本物を回す。
見ているのは、反復の依頼が `auto-continuation` で送られること、結果が返ると次へ進み
上限で止まること、人が止めれば次の反復に入らないこと、起床が `scheduled-trigger` で届き
無いセッションには送らないこと、全部止めるのが上限で必ず返ること。

### renderer を jsdom で描く

`@testing-library/react` と `jsdom` を入れ、`test/renderer/` に置いた。
ファイル先頭の `@vitest-environment jsdom` で切り替えるので、他の検査は node のまま。
描いたのは `Markdown`（mermaid は差し替え）・`Files`・`Board`・`Sidebar`・`Conversation`・
`ToolBlock`・`PermissionBar`・`Attachments`。どれも props だけで決まる部品で、9 割を超えた。

**`render` は検査ごとに `cleanup` すること。** vitest は自動で片付けないので、
残った要素を次の検査が見つけて「複数ある」と落ちる（実際に 3 件落ちた）。

### 線は範囲ごとに引く

全体で 1 本にすると、renderer を足した瞬間に main の線が下がる。
`vitest.config.ts` の thresholds は glob ごとになった。**shared と main は以前の線のまま**
（行 97、分岐 84）。renderer の部品は測った床（行 30、分岐 28）から始める ——
`Forge` / `ForgeSetup` / `NewSession` / `Inspector` / `Loop` / `Palette` / `TaskPanel` /
`TerminalPane` / `Worktrees` / `ModeSwitch` は画面全体を持っていて、まだ描いていない。
床は下がったら落ちる線であって、目標ではない。

### 画面全体を持つ部品も描いた（2026-09-10）

`ModeSwitch` / `Palette` / `Worktrees` / `Inspector` / `NewSession` / `ForgeSetup` / `Forge` を
`window.izuna` を差し替えて描いた（`Loop` と同じ形。`beforeEach` で口を置き直す）。見ているのは
props の描き分けではなく、**口に渡している引数と、返りをどう言葉にするか** —— `removeWorktree` に
`force` が付くのは未 push のときだけ、`forgeCreatePull` の本文がコミットの一覧、`ghCreatePull` の
`base` が upstream の既定ブランチ、会話が無ければコミット文もレビューも頼めない、など。

踏んだもの: jsdom に `scrollIntoView` が無い（`Element.prototype` に空を置く）。同じ字が 2 か所に
出る部品（`Forge` の「閉じる」は差分を畳むのと PR を閉じるの 2 つ、`ForgeSetup` の「Claude Code」は
見出しと行）は `getAllByText` で数を見る。`remember.ts` の控えは module の寿命なので、検査ごとに
`cwd` を変える —— 同じ鍵だと前の検査の値が先に描かれる。

### まだ測っていないもの

- `TerminalPane`（ghostty-web の WASM。jsdom では起こせない。`pnpm shots` が見る）、
  `App.tsx`、`useSessions.ts`
- `main/index.ts`（Electron の起動そのもの。実機で起動して見る）

### push の門（2026-09-08、docs/NIMBALYST.md §3 の 5）

`.githooks/pre-push` → `scripts/prepush.mjs`。`pnpm install` の `prepare` が `core.hooksPath` を設定する。
順に、届けるコミットが無ければ飛ばす／検査用の作者（`t@example.com`、`Test User`、`.invalid`）の
コミットを拒む／manifest が変わったときだけ lockfile の同期を見る／`pnpm verify`。
`IZUNA_SKIP_VERIFY=1` で飛ばせるのは最後だけ。**検査は本物の git リポジトリを作る**
（`test/main-git.test.ts`）ので、逃げ出したコミットが public に乗る穴は Izuna にもあった。
門の検査は `test/scripts-gates.test.ts`。**実行ビットが無いと git は黙って飛ばす。**

### 失敗の記録（2026-09-08、docs/NIMBALYST.md §3 の 4）

`.claude/agent-mistakes.md`。日付、何が起きたか、根本原因、教訓。作業を始める前に読む。

---

## 30. 本物を起動する検査（2026-09-09）

`pnpm e2e`（`scripts/e2e.ts`）。素の `electron .` を `--remote-debugging-port` 付きで起動し、
Playwright の `connectOverCDP` で renderer に繋いで `window.izuna` を呼び、返りの形を見る。
**`_electron.launch` は使わない** —— `--use-mock-keychain` を付けるので `safeStorage` が本物と
違う鍵になる（§7 の罠）。**`shots.ts` は main を動かさない**ので、
「口を足したのに handler が無い」「Forgejo の口のパスが違う」はここでしか分からない。

見るもの: 窓の題、preload の面が `CH` と一致すること、`IPC_VERSION` が main と renderer で同じこと、
読むだけの口 12 個が返ること、Forgejo に届いてトークンが通るなら `forgeRepos` → `forgePulls` →
`forgePullDiff` が差分を返すこと、画面の見出しと釦。**書く口は呼ばない**（push、worktree の削除、セッションの起動）。
2026-09-10 に §32 の枠も足した: `previewOpen` が Forgejo と GitHub 以外を拒むこと、準備の画面 → sandbox の一覧 →
「頁」で覆いが閉じて本体の柱に枠が出ること（セッション無し）、「閉じる」で消えること。埋めた頁の中身は
`WebContentsView` なので CDP からは見えない —— 見ているのは枠と門で、頁が描けたかは人が目で見る。

要るものが多い（組み立て済みのアプリ、Forgejo、保管したトークン）ので `verify` には入れない。
初回（2026-09-09）は `_electron.launch` で書いていて、Forgejo の段が「トークンが読めない」で skip した。
それを本物の不具合と誤診した（§7）。**ハーネスが「本物が壊れている」と言ったら、ハーネス無しで
再現してから人に言うこと。** 素の起動に直したあとはトークンが通り、Forgejo の段に入る。

Forgejo の段の材料は **`izuna/izuna-e2e`**（ボットの下。同日に Izuna 自身の口で作った。
main と feat に 1 コミットずつ、PR !1 は閉じない）。ボットのトークンでは人の下の sandbox が
見えないので、ボットの下に置いてある。消したら `forgeEnsureRepo` → `push` → `forgeCreatePull` で作り直せる。

---

## 31. v1 の 7 手を通す（2026-09-09）

`pnpm walk`（`scripts/walk.ts`）。本物の Izuna を起動し（`scripts/lib/electron.ts`。§30 と同じ起こし方）、
**人の役をスクリプトが演じて** 7 手（docs/GOAL.md 完成の定義）を通し、`docs/v1-walk/` に PNG と
README.md を残す。釦を押す・Issue を選ぶ・依頼を打つ・承認するは画面を操作し、`window.izuna` を
直接呼ぶのは画面に無い確認（remote のブランチ一覧、PR の存在）だけ。

**実 API を呼び、GitHub と Forgejo に書く。** 使い捨てのリポジトリで回す。2026-09-09 に通した
`Watakumi/izuna-v1-walk` は同日に消した。回し直すときは作り直す —— private で作り、`~/work/personal/` に
clone して remote 名を `upstream` にし、src の下に greet.ts と math.ts（1 関数ずつ）を置いた最初のコミットを push し、
Issue #1「greet と math に検査を足す」（2 つは別の worktree で並行してよい、触るのは `test/` の下だけ）を立てる。
sandbox は walk が `forgeEnsureRepo` でボットの下に作る。
`--reset` で前回の worktree・作業ブランチ・sandbox のブランチ・共有フォルダ・GitHub の PR を片付ける。

| 手 | 画面でやること | 通ったと言える条件 |
| --- | --- | --- |
| 1 | `forgeEnsureRepo` → `ensureSandboxRemote` → 既定ブランチを push | `forgeRepos` で `empty: false` になる（push 直後は 404 の罠。§7） |
| 2 | 「新しいセッション」→ リポジトリ → Issue の札（`#1`）→「開く」 | 会話の入力欄が出る |
| 3 | 依頼を打つ（2 つに分けて `Agent` を `isolation: "worktree"` で 2 つ） | 「実行役 … を開きました」が 2 つ、worktree が 2 本 |
| 4 | 待つ。ブレインが `SendMessage` で追加指示を送り「BRANCH:」で報告する | 「止まりました」が 4 回以上（起き直した分を含む） |
| 5 | 出た承認の札を「許可」で押す | 押した数を README に書く |
| 6 | 「forgejo に push」→「sandbox で PR を作る」→「差分」→ upstream に push →「Upstream に PR を作る」 | 差分が描ける。`ghPulls` に出るブランチの PR がある。漏れの判定が「出ていません」 |
| 7 | 実行役のブランチを sandbox に push → PR タブの「作業ブランチ」を消す → 「ブランチ」タブを撮る → セッションを閉じる → worktree を消す | worktree が本体だけ、sandbox のブランチが main と出したブランチだけ。**残っていれば落ちる** |

### 通すまでに直したもの

- 区切りの検出。節目の数で待つと、実行役が 5 分かかったときに切れた。**ブレインの報告（印）で待つ**
- 印は依頼文にも入るので、**送った時点より増えたか**で見る
- Issue の札を題名で探すと「続きから」の行に当たる。`#<番号>` で探す
- 「Upstream に PR を作る」を押すと「情報」タブに戻るので、URL は画面ではなく `ghPulls` で確かめる
- ブレインが共有フォルダへ `cd` したまま `Agent` を起こして失敗した → 申し送りに書いた
- 出すブランチは回すたびに別名（`issue-1-<MMDDhhmm>`）。sandbox の前回の PR は閉じられないので、同名だと non-fast-forward
- 走行を途中で殺すと CLI のロックが worktree に残る。`--reset` は unlock してから消す。製品側も pid が死んでいれば外す（§7）
- 前の Electron が残ると次の走行がそちらに繋がる → `lib/electron.ts` が port を見て断る
- 通った走行は 251 秒、承認 20 件前後（実行役の Bash / Write / Edit を人の役が許可する）

### 実行役の実測は `scripts/probe-team.ts`

walk の前に、一時リポジトリで実行役 2 つを並走させて測った（`.claude/rules/team.md` §12 の
2026-09-09 の表）。`--isolation` で `Agent` の `isolation: "worktree"` を使う方式に切り替える。
結果は `scripts/probe-team*.result.json`（gitignore）。
