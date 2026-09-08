# Nimbalyst との比較

Nimbalyst（https://github.com/Nimbalyst/nimbalyst）を読んで、Izuna と何が違い、
何を取り、何を取らないかを決めた記録。**機能の一覧ではなく、判断の一覧**である。

根拠にしたのは 2026-09-07 の `49220e4b` を shallow clone したもの。数字はすべてそこで数えた。
Nimbalyst は 1 日に何十コミットも動くので、ここに書いた事実は日付つきで読むこと。

---

## 1. 規模

| | Nimbalyst | Izuna |
| --- | --- | --- |
| 本体（ts / tsx、検査を除く） | electron 482,080 行、runtime 214,362 行、extensions 89,394 行 | 約 10,000 行（shared + main 5,848、renderer 3,762） |
| 検査ファイル | 1,457（electron 1,027、runtime 430） | 46 |
| E2E | Playwright 72 本 | 撮影 16 点（`scripts/shots.ts`） |
| パッケージ | 17（iOS / Android / CLI / collab / marketplace を含む） | 1 |
| Star / Fork / open issue | 1,677 / 243 / 619 | — |
| 利用者 | 不特定多数、チーム | 作者ひとり |

約 80 倍。**この差は追わない。** Izuna の柱は 3 本（`docs/GOAL.md`）で、
Nimbalyst の機能の大半はそのどれにも刺さらない。

---

## 2. 設計が違うところ

どちらが正しいかではなく、**前提が違うので答えが違う**もの。Izuna の選択を変えない。

| 論点 | Nimbalyst | Izuna | 変えない理由 |
| --- | --- | --- | --- |
| claude の駆動 | SDK と本物の対話 CLI の両方。承認は `PreToolUse` hook が loopback の HTTP に POST し、590 秒で `ask` に倒す（`resources/claudeCliPermissionHook.cjs`） | SDK の `canUseTool` だけ。5 分で deny（§6） | Nimbalyst が hook を要したのは、端末で本物の CLI も動かし `--permission-prompt-tool` が対話モードで無視されるため。Izuna はヘッドレスなので SDK で足りる |
| 保存 | PGLite / sqlite。`ai_agent_messages`（生）→ `ai_transcript_events`（正規化）の 2 層 | DB を持たない。`~/.claude/projects/` を走査（§18） | 複製を持つと会話と食い違う。Nimbalyst の CLAUDE.md には DB の誤消去で 6 台が空になった事故（#1347）がある |
| worktree | 自前で作る（simple-git、操作ロック、ulid） | 作らない。エージェントの `EnterWorktree` に任せる（§12） | 2 か所に散っていたのを片方に寄せた判断のとおり |
| 承認 | 「agent-verified」に読み取り専用の自動許可（ls / git status / npm ls）とパス制御 | 人だけ（GOAL 完成の定義 5） | 読み取りの自動許可は CLI 側の `permissions.allow` で足りる。アプリが判断を持たない |
| カバレッジ | しきい値なし。代わりに `scripts/` の門が 12 本 | 範囲ごとに線（§28） | どちらも「下がったら気づく」ための線。Izuna は数字、Nimbalyst は構造で見張る |
| 検査の哲学 | 「コンポーネントのソースを `readFileSync` で読んで `toContain` するな。描くか、書かないか。構造の不変条件は `scripts/` に置け」 | `test/surface.test.ts` と `test/auth.test.ts` は文字列の門 | 不変条件（注入口が 1 か所、preload に余計な面が無い）の門としては文字列でよい。**部品の検査には使わない**（§28 で描くようにした） |

---

## 3. 実装するもの（Nimbalyst から取る。効果の大きい順）

| # | 何を | Nimbalyst での根拠 | Izuna での費用 |
| --- | --- | --- | --- |
| 1 | **`ANTHROPIC_API_KEY` を環境から拾わない**（2026-09-08 に実施。`shared/billing.ts`） | CLAUDE.md「Never Use Environment Variables as Implicit API Key Sources」。`.env` の鍵を黙って拾い、利用者の個人口座に 100 ドル超を請求した事故 | `refreshLoginShellEnv()` の結果を claude に渡す前に鍵を落とす。1 行。`test/auth.test.ts` は録画を見るだけで実行時には守っていない |
| 2 | **`AskUserQuestion` の受け皿**（2026-09-08 に実施。`shared/question.ts`、`Questions.tsx`。答えの鍵の形は未検証） | `docs/INTERACTIVE_PROMPTS.md`。問いを部品として描き、答えを返す | SDK ではこれも `canUseTool` に来る。いまは `PermissionBar` に「ツールの許可」として出て、人は選択肢に答えられない。`allow` に `updatedInput` で答えを載せる |
| 3 | **CLAUDE.md を分ける**（2026-09-08 に実施。179 行 + `.claude/rules/` 10 本） | 「先に読む重要規則」だけ CLAUDE.md に残し、残りは `.claude/rules/*.md` に `globs` 付き。触るパスのときだけ読まれる。理由は `rules/token-discipline.md` | Izuna の CLAUDE.md は 2,191 行で毎セッション全部読まれる。§7 や §21 の罠は、そのファイルを触るときにだけ要る |
| 4 | **`.claude/agent-mistakes.md`**（2026-09-08 に実施） | 日付・何が起きたか・利用者の言葉・根本原因・教訓の形で溜める（例: `git stash` を聞かずにやり、別セッションの stash を pop した） | Izuna は CLAUDE.md の各節に散らしている。独立した 1 ファイルなら次のセッションが先に読める |
| 5 | **push の門**（2026-09-08 に実施。`.githooks/pre-push`、`scripts/prepush.mjs`） | `.githooks/pre-push`: 届けるコミットが無ければ飛ばす／manifest が変わったときだけ lockfile の同期を見る／検査用の作者（`Test User`、`@example.com`）のコミットを拒む（2026-07-22 に検査の実リポジトリから public main へ漏れた） | Izuna は `core.hooksPath` が未設定で push を止めるものが無い。検査で実リポジトリを作るので、同じ穴がある |
| 6 | **全 `webContents` にかける窓の門**（2026-09-08 に実施） | `window/windowOpenGuard.ts`: `app.on('web-contents-created')` で全部にかけ、**dev の origin と同じ http は拒む**（markdown の相対リンクが dev サーバへ漏れる） | Izuna は main の窓 1 枚。`shared/links.ts` に 1 条件足す |
| 7 | **コミット前に検査を回す hook**（2026-09-08 に `scripts/commit-gate.mjs` を実施。`.claude/settings.json` は人が置く） | `.claude/settings.json` の `PreToolUse` が、コミット提案の直前に typecheck と単体検査を走らせる | 入れると §26 の関所が Izuna 自身を「hook のあるリポジトリ」と見なす。`trustedRepos` に自分を足す。それ自体は正しい動き |

小さいもの: git に渡す env から `GIT_DIR` 系を外す判断（`gitInheritedEnvUnsafe.ts`）、
検査の最後の結果を `.vitest/last-run.log` に残して木のハッシュで「まだ有効か」を言う `test:last`、
`scripts/` の門に門自身の検査を付けること。

---

## 4. 実装しないもの

Nimbalyst にあって Izuna には入れないもの。**優劣ではなく、三本の柱に刺さらない**という理由。
足したくなったら、`docs/GOAL.md` の「やらないこと」と同じく、まず柱に刺さるかを見る。

| 実装しないもの | Nimbalyst での位置づけ | 入れない理由 |
| --- | --- | --- |
| データベースと 2 層のトランスクリプト保存 | すべての永続化の基盤 | 保存層を持たない（§18）。`~/.claude/projects/` が真実で、複製すると食い違う |
| 拡張 SDK と editor host | 全エディタが同じ契約を通る | 利用者は作者ひとり。拡張の口は保守の対象を増やすだけ |
| 多プロバイダ（Codex、OpenCode、Copilot、Gemini） | 製品の差別化 | 柱は claude の `/` の扱い。抽象化すると `/` の固有性が消える |
| 計測（PostHog）と許可リストの門 | 製品改善の材料 | 送る相手がいない |
| 自動更新とリリースチャンネル | 配布の基盤 | 配布しない。`publish` は消した（§26） |
| コラボ（Cloudflare Workers、JWT）とモバイル | チーム利用の基盤 | 一人で使う。D1 と DO の混同、JWT の取り違え、は Nimbalyst の CLAUDE.md で「最も繰り返された同期バグ」とされている。この層を持ったことの代償 |
| 自前の worktree 管理 | 並列セッションの隔離 | エージェントの `EnterWorktree` に任せる（§12） |
| 読み取り専用の自動許可（agent-verified） | 承認疲れの軽減 | 承認は人が持つ。要るなら CLI 側の `permissions.allow` で足りる |
| 視覚エディタ（mockup、Excalidraw、CSV、Monaco） | 「エージェントの成果を視覚的に編集する」という製品の核 | Izuna は会話と差分を読む道具。編集はエディタでする |

---

## 5. 訂正

Nimbalyst を読んで、Izuna の文書のほうが古い、または違っていたもの。

- **`SafePathValidator` はいま呼ばれている。** §24 と `test/docs.test.ts` は「製品コードからは一度も呼ばれていない」を前提に書いたが、2026-09-07 の main では `services/ElectronFileSystemService.ts` が `validate()` を 3 か所で呼んでいる（`devAgentTools.ts`、`PrivilegedExtensionHost.ts` も使う）。門の価値は変わらない。根拠の記述が事実と違う可能性がある
- **「既存 GUI はどれも `/` を実行しかできない」（§1）は古い。** `components/UnifiedAI/commandPills/CommandPillPopover.tsx` は、コマンドの出どころ（builtin / project / user / plugin）と種別（command / skill）を持ち、本文を見せ、元の `.md` をエディタで開く。Izuna の差別化を「横断的に見て・探して・編集できる」に置くなら、複数リポジトリを跨ぐ検索や実行履歴との突き合わせのように、**Nimbalyst が持たない軸まで言わないと差にならない**

---

## 6. 数え方

再現するときのために、どう数えたかを残す。

```bash
git clone --depth 1 https://github.com/Nimbalyst/nimbalyst.git
# 行数（検査を除く）
find packages/electron -name '*.ts' -o -name '*.tsx' | grep -v node_modules | grep -v -E '\.test\.|\.spec\.|__tests__' | xargs cat | wc -l
# 検査ファイル
find packages/electron \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' \) | wc -l
# Star などは gh api repos/Nimbalyst/nimbalyst
```

読んだ場所: `CLAUDE.md`（283 行）、`.claude/rules/`（16 本）、`.claude/agent-mistakes.md`、
`.githooks/pre-push`、`scripts/*.mjs`、`packages/electron/src/main/{window,security,services/ai}`、
`packages/electron/resources/claudeCliPermissionHook.cjs`、`docs/{AGENT_PERMISSIONS,INTERACTIVE_PROMPTS,FEATURE_INVENTORY}.md`、README。

---

## 7. features ページの判断（2026-09-09）

https://nimbalyst.com/features/ の全項目（10 節）を三本の柱に当てて決めた。
「済み」は既にあるもの、「入れない」は柱に刺さらないもの。**入れると決めた 3 つ**は同日に入れた。

| # | 入れたもの | どこ | 備考 |
| --- | --- | --- | --- |
| 1 | 承認待ちと、止まったときの OS 通知 | `shared/notice.ts`、`main/notify.ts`、`register.ts` の `emit` | **窓が前に無いときだけ**鳴る。押すと窓を前に出す。進捗では鳴らさない |
| 2 | コミット文の釦と、起床の予約の画面 | `Forge.tsx`、`Loop.tsx` の `Wakeups` | 口は前からあり、renderer から呼ばれていなかった 9 つのうちの 5 つを繋いだ |
| 3 | sandbox の PR の差分を見る | `shared/patch.ts`、`client.pullDiff`、`PullDiff.tsx` | 承認の `DiffView` で描く。読むだけで accept / reject はしない。`.diff` の口は**実機で未検証** |

| 入れないもの | 理由 |
| --- | --- |
| 赤/緑の hunk 単位の承認、WYSIWYG、ファイル履歴、Excalidraw、Monaco、文書内 todo | エディタは作らない。承認はツール呼び出し単位で人が持つ |
| PR を worktree で開く | worktree はエージェントが作る（§12） |
| git の staging UI | ターミナルとエージェントで足りる |
| tracker、コラボ 5 件、Context Graph 6 件、拡張 4 件、モバイル 3 件 | やらないこと（§4） |
| 自分の API キー | OAuth だけ（§14）。env の鍵も落とす |
| 自動許可の型（agent-verified） | 承認は人（完成の定義 5） |

保留: ファイル→セッションの逆引き（索引を持つと §18 と衝突）、open source（§20 の 3 点が先）。
