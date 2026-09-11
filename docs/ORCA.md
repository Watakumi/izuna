# Orca との比較

Orca（https://github.com/stablyai/orca）を読んで、Izuna と何が違い、何を取り、何を取らないかを
決めた記録。docs/NIMBALYST.md と同じく**機能の一覧ではなく、判断の一覧**である。観点は
アーキテクチャ・セキュリティ・UI / UX・マーケティング・ブランディングの 5 つで、それぞれ別の
分析役が読み、私が突き合わせて書いた（2026-09-11）。分析役の報告のうち Izuna 側の事実と
食い違ったものは §10 に記録した。

根拠にしたのは 2026-09-10 の `f2d5711b`（v1.4.197）を shallow clone したもの。Web と GitHub API は
2026-09-11 に取った。Orca は 1 日に何十コミットも動くので、ここに書いた事実は日付つきで読むこと。

---

## 1. 規模

| | Orca | Izuna |
| --- | --- | --- |
| 本体（ts / tsx、検査を除く） | `src/` 1,661,098 行（renderer 824,841、main 647,253、shared 129,540、relay 28,856、cli 19,568、preload 11,001）。外に mobile 134,761、cloud 24,176 | 14,906 行（renderer 6,350、shared 4,547、main 3,954、preload 55） |
| 検査ファイル | 9,312（`it(` / `test(` 67,560） | 73（830） |
| E2E | Playwright 363 本 | `scripts/e2e.ts` 1 本 + `walk.ts` の 7 手 |
| CI workflow | 63（うち cloud 28、mobile 2） | GitHub 3 + Forgejo 1 |
| 扱うエージェント | 36 種（TUI）+ 2 種（構造化） | Claude 1 種（SDK） |
| Star / Fork / open issue | 65,716 / 4,329 / 2,776（2026-03-17 作成。半年） | — |
| リリース | ほぼ毎日（v1.4.192 → 199 が 08-29 → 09-09）。資産 21 個 | v0.1.0（2026-09-10） |
| 利用者 | 不特定多数。並列にエージェントを走らせる開発者 | 自分の Forgejo を持つ人 |

約 110 倍。Nimbalyst（約 80 倍）よりさらに大きい。**この差は追わない。** Izuna の柱は 3 本
（docs/GOAL.md）で、Orca の機能の大半は「どの CLI でも並べる IDE」のためにあり、柱に刺さらない。

---

## 2. アーキテクチャ —— 設計が違うところ

どちらが正しいかではなく、**前提が違うので答えが違う**もの。

```
Orca:  renderer ─IPC(preload)─ main ─ runtime ─JSON-RPC(unix socket / WebSocket)─ cli / mobile / 別の Orca
                                      ├ relay   SSH 先に置く Electron 非依存の束（PTY・git・fs・hook を代行）
                                      ├ orcad   画面なしのデーモン
                                      └ daemon  PTY を常駐させ、再起動を跨ぐ
       cloud/  モバイル⇔デスクトップの relay サーバ（Terraform つき）   mobile/  Expo 55
```

| 論点 | Orca | Izuna | 変えない理由 |
| --- | --- | --- | --- |
| エージェントの駆動 | 2 段。**TUI レーン**は 36 種の本物の CLI を node-pty で走らせ、状態は hook から取る（Claude には `~/.claude/settings.json` に 9 種の managed hook を書き込み、curl で relay の HTTP サーバに POST させる。`src/main/claude/hook-settings.ts:42-94`）。**構造化レーン**は claude と codex だけで、claude は Agent SDK 0.3.251 を exact 固定 | SDK の `query()` だけ。`canUseTool` と `hooks` が直接来る（§6、§12） | Izuna はヘッドレスなので端末の中の CLI を外から覗く必要が無い。利用者の `~/.claude/settings.json` を触らない |
| claude の子プロセス | SDK に spawn させず自前で spawn。SDK 同梱の CLI は 8 プラットフォーム分を `ignoredOptionalDependencies` で全部外し、利用者の `claude` を `pathToClaudeCodeExecutable` で指す（`claude-agent-sdk-process-spawn.ts:30-34`「SDK の SpawnedProcess は pid を持たない」「Windows の .cmd」） | SDK の既定の spawn。本体は `locate.ts` で解く | 理由が Windows と pid の所有権。Izuna は macOS だけで、SDK の spawn で困っていない |
| 承認 | 構造化レーンは人（`canUseTool` を registry に登録して renderer へ）。**中断は `null` で「答えない」**、壊れた要求は deny（`claude-structured-inbound-control.ts:52-84`）。TUI レーンは端末の中で人が押す | 人。中断と終了は deny、5 分で deny（§6） | 同じ「人が持つ」。Izuna は「答えない」を区別せず deny に倒す。fail-closed としてはどちらも成り立つ |
| 保存 | 3 層。`agent-sessions.json`（temp → fsync → rename。lease と所有者の証明）、`node:sqlite` の journal、他ツールの記録の走査（`ai-vault/` が `~/.claude/projects` ほか 8 種を読む） | 走査だけ（§18） | Orca は再起動・SSH・モバイルを跨いで lease を証明する必要がある。Izuna にその跨ぎは無い。「走査する」は Orca もやっている |
| worktree | Orca が作る（`git worktree add`）。`orca.yaml` に setup / archive スクリプトと `sharedDirectories`（node_modules の symlink）。Claude の `.claude/worktrees` は「エージェントの scratch」として認識だけ | エージェントの `EnterWorktree` / `isolation` に任せる（§12） | Orca は Claude 以外も動かすので CLI に任せられない。Izuna は 2026-09-08 に一本化した |
| forge | GitHub / GitLab / Bitbucket / Azure DevOps / **Gitea（Forgejo）** の 5 つ。Gitea は `ORCA_GITEA_TOKEN` を env から読む（`src/main/gitea/client.ts:56-59`）。**sandbox と upstream を分ける概念は無い**（1 リポジトリ 1 provider） | GitHub は `gh`、Forgejo は自作。二段（GOAL.md 柱 2） | 二段は Izuna の差別化そのもの。Orca に Forgejo があっても同じものではない |
| 口の契約 | `ipcRenderer.invoke('worktrees:list')` の文字列直書きが preload の bridge 137 ファイルに散る。`ipcMain.handle` 759 か所。代わりに **wire の版**を負う（capability negotiation、`cross-version-wire` の CI job） | `shared/ipc.ts` の `CH`（66 鍵）から preload と `IPC_VERSION` を導く（§27） | Orca には別マシンの古いクライアントが常にいる。Izuna は 1 プロセス対で、中央の表で足りる |
| 検査の線 | **カバレッジの設定は無い。** 代わりに ratchet 4 本（max-lines、`@ts-nocheck` 176、runtime→electron 6、`child_process` 直 import 165）と reliability gates の台帳 118 件 —— **ただし 118 件すべて experimental で、blocking は 0** | カバレッジの線（範囲別 + ファイルごとの床。§10） | Nimbalyst と同じ「構造で見張る」派。Izuna は数字で見張る。台帳を持っても門にしなければ線ではない |
| 規則の置き場 | `AGENTS.md` 99 行 + `docs/reference/` 30 本。`CLAUDE.md` は `@AGENTS.md` の 1 行 | `CLAUDE.md` + `.claude/rules/` 10 本 | 同じ発想 |
| 依存 | electron 43.6.0 と SDK は exact、`minimumReleaseAge` 4,320 分（3 日）、**除外 2 件に公開日時と解除日時を註で書く**、`patchedDependencies` 8 件 | `minimumReleaseAge` 1,440 分、除外は SDK の platform（理由は CLI と連動） | 除外に「いつ消せるか」が書いてないと永久に残る。取る（§7） |

---

## 3. セキュリティ

Orca は**内蔵ブラウザの guest を封じること**に力を注ぎ、**自分の renderer の土台**は緩い。
Izuna はその逆で、土台（§26「配るための固め」）を全部やり、webview を持たない。

| 項目 | Orca | Izuna |
| --- | --- | --- |
| renderer の砂場 | `sandbox: true` のみ明示。`contextIsolation` / `nodeIntegration` は既定に依存。`webviewTag: true`（`src/main/window/createMainWindow.ts:132-140`） | 3 つ明示 |
| preload が出す面 | `electronAPI`（`@electron-toolkit/preload`）と `api` の 2 つ。renderer からの `ipcRenderer` 参照は 0 件 | `CH` から組む面だけ。`electronAPI` は出さない（§26） |
| CSP | **main renderer に無い。** `index.html:6` は「electron-vite が本番で注入」とコメントするが、注入する処理は見当たらない（ビルド出力は未検証） | 有り。`test/design-system.test.ts` が門 |
| fuses | **無い。** `RunAsNode` が生きていて、CLI が実際にそれを使う設計（`config/electron-builder.config.cjs:233`） | 7 つ切る（`build/fuses.mjs`） |
| 配る URL | `loadFile`（file://） | `app://renderer/` |
| 窓の門 | 窓ごとに `setWindowOpenHandler`。`web-contents-created` は WebRTC の UDP 対策の 1 か所だけ | 全 webContents に 1 回 |
| `<webview>` | 内蔵ブラウザの本体。`will-attach-webview` で partition を registry で照合し、preload を消し、`nodeIntegration=false` / `contextIsolation=true` / `sandbox=true` / `webSecurity=true` を**強制上書き**、許可外は `preventDefault`（`main-window-webview-security.ts:66-110`） | 無し。§32 の頁は `WebContentsView` 1 枚で、3 つを明示して起こす（`main/preview.ts:22-27`） |
| 頁の権限要求 | main 窓は media / fullscreen / pointerLock を許す | 全部 false |
| entitlements | apple-events / audio-input / bluetooth / camera / usb / location / allow-dyld-environment-variables / allow-jit / allow-unsigned-executable-memory（`resources/build/entitlements.mac.plist:5-22`）。子プロセス（利用者の道具）に権限を継がせるため | 最小。§26 で雛形の分を消した |
| `verify:macos-entitlements` | plist の重複キーを見るだけ（`codesign` が落ちるのを防ぐ）。**セキュリティの検査ではない** | — |
| API キー | 「管理されたアカウント」を選んだときだけ `ANTHROPIC_*` を剥がす。無ければ利用者の鍵をサインインとして通す（`claude-accounts/environment.ts:56-69`） | 常に落とす（`shared/billing.ts`。Nimbalyst の事故が根拠） |
| 鍵の保管 | `safeStorage`。Linux で `basic_text` に落ちたら「守られていない」と利用者に言う（`electron-secret-store.ts:30-53`）。Linear の鍵は平文 0600 の fallback | `safeStorage`。使えなければ保管を拒む（§15） |
| ログ | 誤り追跡の redactor が `sk-ant-` / `gh*_` / JWT / PEM / URL userinfo / `.env` 行を消す。3 か所（`observability/redactor.ts:1-80`） | 無し。送る相手がいない |
| **ツール承認（TUI）** | **既定で承認を外して起動する。** `DEFAULT_TUI_AGENT_ARGS = YOLO_TUI_AGENT_ARGS`（`src/shared/tui-agent-launch-defaults.ts:10`）。claude は `--dangerously-skip-permissions`、codex は `--dangerously-bypass-approvals-and-sandbox`、gemini は `--yolo`、27 種（`tui-agent-permissions.ts:6-33`）。設定で戻せる | 該当無し。承認は人が持つ（規則 1） |
| 信頼の関所 | cursor / copilot / codex の「このフォルダを信頼するか」を、**Orca が先に信頼ファイルを書いて飛ばす**（`agent-trust-presets.ts:11-30`。理由は貼り付けがメニューに食われるため） | hook と `.mcp.json` を数え、信頼していなければ開く前に止める（§26） |
| `settingSources` | `['user','project','local']`。開く前に hook / `.mcp.json` を数える門は無い | `['project','local']`（§13） |
| 危険なコマンドの判定 | 無い | 無い（人が見る） |
| computer-use | 別 bundle の helper に TCC（Accessibility・Screen Recording）。Unix socket + 認証済み接続。呼ぶ前に毎回人が承認する仕組みは読んだ範囲に無い（未検証） | 無い |
| サプライチェーン | CI action は**タグ固定**（SHA 0 件）、gitleaks は `cloud/` の履歴だけ、`pnpm audit` / osv / Dependabot / Renovate どれも無い、`SECURITY.md` 無し。自動更新は Squirrel + SignPath + Linux は sha512 を自前で照合 | コミット固定、gitleaks 全体、osv + Dependabot、`SECURITY.md`。自動更新は持たない |

**Orca 側で Izuna より弱いと見えるもの（根拠のあるものだけ）**: TUI を既定で承認なしに起動する。
他エージェントの信頼確認を先に書いて飛ばす。main renderer に CSP が無い。fuses が無く `RunAsNode` が
生きている。`allow-dyld-environment-variables` と `allow-unsigned-executable-memory`。action がタグ固定で
脆弱性の走査が無い。リポジトリの hook と `.mcp.json` を開く前に数えない。

**Izuna が学ぶもの**: `minimumReleaseAge` を 3 日に上げ、除外に解除の条件を書く。`run()` の stderr と
例外の文面に redactor を 1 段入れる（§27「stderr を捨てない」は、逆に stderr が鍵を含んだとき画面に
出る）。`shouldOpenOutside` に `file:` を理由つきで明示的に拒む行を置く（いまは allowlist で落ちるが、
広げたとき気づけるように）。

---

## 4. UI / UX

| | Orca | Izuna |
| --- | --- | --- |
| 部品 | tsx 1,581 本（検査を除く）、`components/` 直下 145 | tsx 25 本、5,187 行 |
| 殻 | 左 Sidebar（worktree の札）→ 題名帯 → 中央 9 頁を切替（settings / skills / artifacts / tasks / automations / activity / space / mobile / terminal）→ 右 Sidebar（files / search / Source Control / plugin） | 左 Sidebar（セッション）→ 会話の柱 → 右パネルの 6 タブ |
| 並列の見せ方 | 1 worktree = 1 札、札の中に agent の行。状態 10 語（working / monitoring / blocked / waiting / interrupted / failed / done / idle / unverifiable / permission）。中央は tab group + 列分割（dnd-kit）。俯瞰の Agent Dashboard は別窓に出せる | 1 セッション 1 柱。実行役は `TaskPanel` |
| 状態管理 | zustand 単一 store に 46 slice。listener の数を数える census、selector の fanout のベンチまである | `useState` + `useSessions`。畳むのは `shared/transcript.ts` の純粋関数 |
| ターミナル | xterm.js 6.1 beta + webgl。**Ghostty は VT ではなく配色の取り込みだけ**（`src/main/ghostty/theme-resolution.ts:14-25`）。Warp のテーマも取り込む | ghostty-web（本物の VT）。色も Ghostty から比で導く（§21） |
| 差分 | Monaco の DiffEditor。行に「Note」を付けて agent に送り返す（GitHub の Comment と混同しないよう Note と呼ぶ） | 読むだけ（§29） |
| 承認 | 「Allow {{tool}}?」+ 要約 1 行 + Allow / Deny。押すと **PTY に `1` か ESC を書く**（`native-chat-interactive-prompt.ts:71-78`）。「聞かれている」は橙 1 色 1 アイコンを**サイドバー・タブ・ダッシュボード・地図の 4 面**に同じものとして出す（`AgentQuestionIcon.tsx`。CSS の註「amber ではなく orange。working の黄と地図上で見分けるため」） | SDK の握手。`PermissionBar` と、帯の「承認待ち n」 |
| 問い | 番号付き選択、複数問はタブ、自由記述。**選んだだけでは送らず Send / Next を押す**（`NativeChatQuestionCard.tsx:88-90` の註「自動送信は『何も起きなかった』に見えた」） | `Questions.tsx`。全部答えるまで送れない。同じ思想 |
| 言葉 | i18next、6 言語。en の葉 14,237 件（900KB）、ja は 2,188 件が未訳で英語に落ちる。**鍵の 94% は `auto.<path>.<hash>`** で、英語の既定文字列が真実。AST で `t()` を集める門 4 本、`aria-label` / `placeholder` / `title` も文言として数える。`NEVER_TRANSLATE_VALUES`（機械翻訳が Codex → copy、Gemini → zodiac にした事故が根拠） | 日本語 1 本、188 件を人が洗う（§17.4） |
| 文言の作法 | STYLEGUIDE「UI copy must not overclaim」「please / simply / just を消せ」（数えると please 6 件）。失敗の文は Failed to 227 / Could not 132 / Couldn't 43 / Unable to 37 の **4 通りが混在** | 「同じことを同じ言葉で言う」（§17.4） |
| 比喩 | **意図して使う。** worktree を Sleep（`agentHibernation`）、テーマ選びは「Make it feel like home」、画面の隅で動く Pet、AI Vault、Design Mode、Feature wall、star をねだる star-nag | 使わない（§17.4） |
| オンボーディング | agent → theme → gh → notifications の順に設定を聞き、作文はさせない（§17.5 と同じ）。Feature wall は 12 タイルの GIF に `recorded-at.json`（2026-05-13）を付け、`check:feature-wall-assets` が欠けを見張る | 無し。空の画面に「新しいセッションを開く」と「準備」 |
| 見た目 | Tailwind v4 + shadcn。無彩色（dark `#0a0a0a` / `#fafafa`）、色は状態にだけ。「monochrome and quiet」。**コントラスト比を測る検査は無い**（未検証）。Geist 同梱、lucide のみ。STYLEGUIDE に**所要時間別のフィードバック表**（100ms 未満は何も出さない / 1〜3 秒はスピナー / 3 秒超は段階の札）と「幅は先に確保する」 | Ghostty の色から比で導き、`pnpm shots` が 166 箇所を比 6 以上で見る（§21、§22） |
| a11y・キー | `aria-label` 1,288、`role` を持つファイル 225。キーバインド 88 手、`~/.orca/keybindings.json`。「札は実際の束縛と一致させる」 | `aria` 1、キーは Cmd+Enter 1 つ |
| 検査 | vitest 8,167 本（happy-dom を宣言するのは 955 本）、Playwright 363 本、`toHaveScreenshot` は 0。`tests/e2e/AGENTS.md`「store で状態を作り、**DOM で確かめる**」（store だけを見て壊れた画面を通した事故 #1186） | jsdom 16 本 + shots + e2e + walk |

**§17.4 から見た Orca。** overclaim の禁止と please の排除は §17.4「事実でない説明を添えない」と同じ
方向で、数字のとおり守られている。一方で比喩は意図して使い、そのぶん**説明文が要る** ——
Sleep には `agentHibernation.copy` の 3 文が付く。日本語訳ではそれが崩れ、「Make it feel like home」は
「まるで家にいるような気分にさせてくれる」（釦の題として読めない）、「needs attention」は「注意が必要です」
（人の手が要る、が抜ける）になる。§17.4 が言う「訳すと文書と画面が食い違う」がそのまま起きている。
失敗の文が 4 通りあるのも「同じことを同じ言葉で」の反例として引ける。

**Izuna が学ぶもの**: 「聞かれている」の印をサイドバーの札にも置く（帯には「承認待ち n」があるが、
どのセッションかは札を見ないと分からない）。所要時間別のフィードバック（「読んでいます…」を 100ms 未満で
出さない、釦の幅を先に取る）。§17.4 の禁止語を grep で落とす門。Esc で覆いを閉じる。アイコンだけの釦に
`aria-label`。

---

## 5. マーケティング

Orca が売っているのは「どのエージェントでも、どの OS でも、無料で、毎日新しくなる」。半年で
65,700 星まで伸びた仕組みは機能の多さではなく**摩擦の少なさ**で、入口を全部用意し、自動更新と
in-app の nudge で戻ってこさせ、Discord と WeChat で囲う。

| | Orca | Izuna |
| --- | --- | --- |
| 対象 | 複数の CLI エージェントを並列に回す個人・チーム。「Run any coding agent with your own subscription」 | 自分の Forgejo を持つ人（GOAL.md） |
| 価格 | 無料・MIT。課金の口は `src/` に無い（`billing` / `paywall` / `license key` で 0 件）。ただし `login.onorca.dev` と `share.onorca.dev` の「Orca Cloud」があり、org のメンバー管理まで実装済み。チーム向け有料化の下地と読める（価格表は無い。未検証） | 無料・MIT |
| 配布 | GitHub Releases（mac arm64 / x64、Windows exe、Linux AppImage / deb / rpm）、Homebrew tap（`stablyai/homebrew-orca`。本体の `Casks/orca.rb` は 1.3.24 で止まった写し）、AUR、iOS App Store / TestFlight、Android APK。Windows の署名は SignPath が提供 | GitHub Releases の DMG（arm64）1 本。署名なし。自動更新なし |
| 約束と実装 | feature wall 9 枚を `src/` に当てると 8 枚は実体がある。**言い過ぎは 2 つ**: 「Fan one prompt across five agents」は docs にその流れの記述が無く手で 5 つ作る前提、「Ghostty-class terminals」の実体は xterm.js で Ghostty は設定の取り込みだけ。「100x builders」は測った形跡が無い。「we ship daily」は本当（30 日で安定版 21 本、tag 1,097 本） | 7 手を `pnpm walk` で本物で通し、docs/v1-walk/ に残す（§31） |
| 差別化 | **中立**（27 社のロゴ。「if it runs in a terminal, it runs in Orca」）、**BYO subscription**（推論を売らない）、**制御面の所有**（worktree・端末・ブラウザ・モバイルを 1 枚に）。第三者の記事は競合に Conductor・cmux・Superset・Emdash を挙げ、Cursor を「単一エージェント」と対置する。Claude Code 公式に対しては「ベンダーが fleet を出したら Orca はそれを載せる側」 | sandbox と upstream の二段（他に無いと調べて確かめた。docs/GOAL.md） |
| 成長 | 月 1 万星。直近 30 日で 2,313 commit。**上位 4 人で 8,556 commit** —— 中身は 4 人の会社が書き、外の 358 人は薄い。open PR 約 3,000 は受け切れていない証拠でもある。計測は PostHog（US）。opt-out は設定・`DO_NOT_TRACK=1`・`ORCA_TELEMETRY_DISABLED=1`・CI 検出だが、**新規インストールは断り無しで送る**（`TelemetryFirstLaunchSurface.tsx` の註「default-on with no first-run notice」）。electron-updater と `updater-nudge.ts`（`onorca.dev/whats-new/nudge.json`）。Discord、X、WeChat グループ 8・9、README 6 言語、plugin marketplace | 星 0、v0.1.0 の download 0（2026-09-11）。GitHub の topics 0 件、description は日本語 1 行 |
| 会社 | Stably AI の本業は Playwright ベースの AI E2E テスト（Hobby $0 / Team $60 / Growth $250）。Orca からテスト製品へ向く経路は無く、リード獲得の装置ではない。YC の頁は Orca を「flagship product」と書く。**推測**: 本業より Orca が伸びたので会社の顔を差し替えている途中で、収益化は Orca Cloud に置く算段 | 個人 |

**Izuna が学ぶもの**: GitHub の看板（英語 1 行の description と topics。Orca は 18 個）。Homebrew tap
（Cask 1 ファイル。署名なしでも `caveats` に `xattr` の手順を書ける。docs/SETUP.md がそのまま材料）。
Releases を変更履歴にする（Orca「The changelog is the real feature list」。Izuna は `.claude/rules` に
決定を溜めているので、版を上げるときに写す）。README に動く証拠を置く（docs/v1-walk/ の PNG）。
読者のいる場所に出す（Forgejo を持つ人なら Forgejo の Matrix と Codeberg の Discussions。反応は未検証）。

**学ばないもの**: 計測（断り無しの default-on は GOAL と衝突する）。自動更新と nudge（署名なしの DMG に
足すと供給網の一番弱い所が増える）。多 OS・多エージェント・モバイル・6 言語・marketplace（GOAL の
「やらないこと」。362 人でも中身は 4 人で、作者ひとりで同じ面積は持てない）。毎日リリース（門は `pnpm verify`
と `pnpm walk` で、版は人が上げる。頻度を競うと fixture の録り直しが追いつかない）。

---

## 6. ブランディング

| | Orca | Izuna |
| --- | --- | --- |
| 名前の由来 | **どこにも書いていない**（README、docs、onorca.dev、YC、stably.ai）。whale / pod の語も 0 件 | 書いていない |
| ロゴ | 自作 SVG 1 本（跳ねるシャチを 3 つの白い帯に略す。目も口も無い）。既定は黒地に白、代替に青と水彩の 2 つ。macOS は Icon Composer、Windows は余白を 2% に（issue #5357）。**Linux だけ実行ファイル名が `orca-ide`**（mac / win は `orca`） | **electron-vite の雛形の原子ロゴのまま**（`build/icon.png`。最初のコミットから変わっていない） |
| 語彙 | en.json 14,237 本で workspace 651 / agent 629 / run 420 / project 378 / worktree 274 / session 264。**同じものに workspace と worktree の 2 語**。「Orca」を含む文字列 731 本 | team.md §12 と GOAL で決め、画面と文書で同じ字。名札は消した（§17.4） |
| 自己紹介 | **8 通り。** README「The AI Orchestrator for 100x builders」、package.json「Next-gen IDE for parallel agentic development」、GitHub「the ADE for working with a fleet of parallel agents」、Cask「IDE for orchestrating AI coding agents across terminals and worktrees」、onorca.dev「Ship 100x with the agent IDE」、docs「the worktree IDE for AI coding agents」、YC「MIT open source terminal-based agent orchestrator」、stably.ai「the agentic IDE for parallel coding agents」。種別語が IDE / ADE / Orchestrator で揺れ、残る芯は parallel / worktree / agents | **3 通り。** package.json「Claude Code を Codex のように使う macOS デスクトップアプリ」、README「Claude Code を Codex のようにデスクトップから使う macOS アプリ」、GitHub の description「Claude Code を自分の Forgejo と一緒にデスクトップから使う」。Orca を笑えない |
| 文体 | README 272 行、絵文字 0、`!` 0。見出しは名詞、本文は命令形。docs は二人称 | README 43 行、事実と根拠、絵文字 0 |
| 視覚 | 無彩色 + Geist + lucide。ターミナルだけ Ghostty から借りる。README の画像 50（バッジ 6、hero 1、feature wall 9、対応エージェントのロゴ 29、WeChat QR 2） | 全画面を Ghostty の色から比で導く。手描き SVG 5 個。README に画面は 0 枚 |
| 通知音 | 9 本（beep, blip, blop, bong, clack, ding, sonar, thump, two-tone）。既定は `system` | 無し |
| 会社 | Stably AI（YC W22、4 人、SF。本業は E2E テスト生成だったが、いま stably.ai のトップは「Meet Orca IDE」）。LICENSE の著作権者は Lovecast Inc.（同一法人かは未検証）。独自ドメイン onorca.dev、@orca_build、Discord。**会社のほうが製品に寄っている** | 個人 |
| OSS としての振る舞い | MIT。CONTRIBUTING、PR テンプレート（before / after の視覚証拠必須、AI 開示、**X のハンドルを書かせて merge 時に宣伝**）、Issue フォーム 3 種（英語限定）、CODEOWNERS。Discord の bot が Issue を起こす。直近 100 件の closed は中央値 12.6 時間で閉じ 75% にコメントがある一方、open は 14% にしかコメントが無い。`CODE_OF_CONDUCT` / `SECURITY.md` は無い | MIT。`SECURITY.md`。CONTRIBUTING と Issue テンプレートは無い |

**Izuna が学ぶもの**: 自分のアイコンを持つ（単色 1 パスの SVG が 1 本あれば icns / ico / tray は機械的に
出る。雛形の原子は「作りかけ」と読まれる）。自己紹介を 1 文に固定し、package.json と README の 1 行目が
同じであることを `test/docs.test.ts` で門にする（Orca が 8 通りに割れたのは置き場を数えていないから）。
名前の由来を 1 段落書く（Izuna は綴りから意味が引けない）。README に画面を 1 枚置き、録った日を添える
（§22 と §31 の録画の仕組みがあるので費用は低い）。

**学ばないもの**: 代替アイコン・通知音・水彩の絵（一人の道具に選ばせる価値より保守が勝つ）。
「100x」の煽り（§17.4）。画面に名前を出すこと。Geist と lucide の同梱（書体は Ghostty から借りる。
アイコンは 5 個）。7 言語の README と i18n。X のハンドルを書かせる PR テンプレート。telemetry。

---

## 7. 実装するもの（Orca から取る。効果の大きい順）

| # | 何を | Orca での根拠 | Izuna での費用 |
| --- | --- | --- | --- |
| 1 | **「聞かれている」の印をサイドバーの札に** | `AgentQuestionIcon.tsx`。1 色 1 アイコンを 4 面に同じものとして出す | `Sidebar.tsx` の札に `pending` を見る点を 1 つ。半日。GOAL「承認待ちが埋もれない」に直結 |
| 2 | **自分のアイコン** | `resources/logo.svg` 1 本から全 OS を生成 | SVG を 1 本描き、`build/` を差し替える。半日〜1 日 |
| 3 | **§17.4 の禁止語を落とす門** | `verify-localization-*` が JSX の生文字と `aria-label` / `placeholder` / `title` を文言として数える | `test/docs.test.ts` の隣に、renderer の文言を抜いて禁止語（起こす・畳む・回す・触る・落とす…）を grep する検査。半日 |
| 4 | **自己紹介を 1 文に固定して門にする** | 8 通りに割れた反例 | `package.json` の `description` と README の 1 行目を同じにし、`docs.test.ts` で見る。1 時間 |
| 5 | **ratchet の形** | `check-*-ratchet.mjs`。baseline は縮む方向にしか動かせない | §27「握りつぶした例外 57 か所」を baseline にして、増えたら落とす。1 日 |
| 6 | **`minimumReleaseAge` を 3 日にし、除外に解除の条件を書く** | `pnpm-workspace.yaml:7-11` | 数行。Dependabot の cooldown 7 日と整合する |
| 7 | **所要時間別のフィードバック** | STYLEGUIDE UX rule 1 | 「読んでいます…」を 100ms 未満で出さない、釦の幅を先に取る。`ui.tsx` の `Button` と `Faint`。1 日 |
| 8 | **redactor を 1 段** | `observability/redactor.ts` の 8 本の pattern | `run()` の stderr と例外の文面に当てる純粋関数。半日 |
| 9 | **Esc で覆いを閉じる、アイコン釦に `aria-label`** | キーバインド 88 手、`aria-label` 1,288 | 準備・新しいセッション・枠の 3 つに Esc。`Reload` に `aria-label`。半日 |
| 10 | **README に画面を 1 枚と録った日** | feature wall の `recorded-at.json` | `pnpm walk` の PNG から 1 枚。1 時間 |
| 11 | **名前の由来を 1 段落** | 書いていないことの反例 | README か GOAL に。30 分 |
| 12 | **「hook を利用者の設定ファイルに書かない」判断を文書に** | `hook-settings.ts` が `~/.claude/settings.json` を書く | team.md §12 に 3 行。15 分 |
| 13 | **GitHub の看板** | topics 18 個、英語 1 行 | description を英語 1 行にし、topics（claude-code / forgejo / electron / worktrees）を付ける。30 分 |
| 14 | **Homebrew tap** | `stablyai/homebrew-orca` | `watakumi/homebrew-izuna` に Cask 1 ファイル。`caveats` に `xattr` の手順。1〜2 時間 |
| 15 | **Releases を変更履歴にする**（保留） | 「The changelog is the real feature list」 | 版を上げるとき `.claude/rules` の差分を Release note に写す。**保留（2026-09-11、利用者）**: 規則の差分をどう書くか、規則の記述方針そのものが決まっていない。決めてから |

小さいもの: `shouldOpenOutside` に `file:` を理由つきで明示的に拒む行、Forgejo の `/pulls` は
head では絞れず同時に叩くと小さな Forgejo が落ちる（Orca #8807）ので一覧を 1 本に coalesce する
（Izuna はいま 1 回の load で 1 本なので、増やすときに思い出す）。

---

## 8. 実装しないもの

Orca にあって Izuna には入れないもの。**優劣ではなく、三本の柱に刺さらない**か、規則に反する。

| 実装しないもの | Orca での位置づけ | 入れない理由 |
| --- | --- | --- |
| 36 種の TUI レーンと hook による状態取得 | 製品の核（どの CLI でも並べる） | ヘッドレス SDK で `canUseTool` と `hooks` が直接来る。端末の中を外から覗く必要が無い |
| 既定で承認を外して起動すること、信頼の関所を先に書くこと | 貼り付けや承認疲れの回避 | 規則 1「承認は人が持つ」、§26 の関所に真正面から反する |
| 自前の spawn と SDK CLI の除外 | Windows と pid の所有権 | macOS だけ。SDK の spawn で困っていない |
| `node:sqlite` の journal と JSON の台帳 | lease を再起動・SSH・モバイルで跨ぐ | 規則 2「保存層を持たない」。跨ぐものが無い |
| Orca が worktree を作ること、`orca.yaml` | Claude 以外も動かすため | §12 で `EnterWorktree` に一本化した |
| relay / orcad / daemon / cloud / mobile | 別マシンとモバイルの基盤。CI 63 本のうち 30 本がこの層 | やらないこと（GOAL.md） |
| plugins / skills の配布、`<webview>` の内蔵ブラウザ | 拡張と閲覧 | 拡張機構は作らない。頁は `WebContentsView` 1 枚で足りる（§32） |
| zustand と 46 slice、Monaco と行 Note、xterm | 状態・差分・端末 | 状態は純粋関数で畳む（§4）。Izuna は読む道具（§29）。ghostty-web が柱 3 |
| i18n（6 言語、鍵をハッシュ化） | 世界に配る | 日本語 1 本。鍵がハッシュだと文言の grep が効かなくなる |
| Pet、star-nag、Feature wall、代替アイコン、通知音 9 本 | 営業と愛着 | 自分の Forgejo を持つ人の道具に営業の面は要らない |
| reliability gates の台帳 | 118 件の不変条件 | 全部 experimental で門になっていない。線を守るほうが安い |
| 自動更新、telemetry | 配布と改善の基盤 | 更新しない（§26）。送る相手がいない（GOAL） |
| 毎日リリース、Discord / WeChat、marketplace | 戻ってこさせ、囲う | 版は人が上げる。読者は Forgejo を持つ人で、そこ以外に出しても届かない |
| `electronAPI` の露出、file://、広い entitlements | 内蔵ブラウザと「利用者の道具に権限を継がせる」代償 | その用途が無い |

---

## 9. 数え方

```bash
git clone --depth 50 https://github.com/stablyai/orca   # f2d5711b, 2026-09-10
for d in src/*/; do find "$d" \( -name '*.ts' -o -name '*.tsx' \) ! -path '*__tests__*' ! -name '*.test.*' ! -name '*.spec.*' | xargs cat | wc -l; done
find . \( -name '*.test.ts*' -o -name '*.spec.ts*' \) ! -path '*node_modules*' | wc -l   # 9,312
find tests/e2e -name '*.spec.ts' | wc -l                                                # 363
grep -c '"id":' config/reliability-gates.jsonc                                          # 118
node -e "…locales/en.json の葉を数える"                                                 # 14,237
gh api repos/stablyai/orca                                                              # star / fork / issue（2026-09-11）
```

Izuna 側は `src/` を同じ数え方で 14,906 行、`test/` は 73 ファイル、`pnpm verify` は 1,194 件。

---

## 10. 訂正

分析役の報告のうち、Izuna 側の事実と食い違ったもの。文書に残すのは、同じ読み違いを次のセッションが
繰り返さないため。

- 「Izuna は Forgejo のトークンを `~/.izuna/config.json` に平文で置いている」 —— **違う。**
  `app.getPath('userData')/forge-token.bin` に `safeStorage` で暗号化して置く（config.md §15）。
  `~/.izuna/` を見て「無い」と言うのは、2026-09-07 に一度やった間違いと同じ。
- 「Izuna の `canUseTool` は中断の `signal` を見ていないかもしれない」 —— **見ている。** 中断と終了で
  deny に倒す（testing.md §10 の「承認の fail-closed」）。Orca は `null` で「答えない」を区別するが、
  fail-closed としてはどちらも成り立つ。
- 「Izuna の埋め込み頁は `nodeIntegration` を既定に頼っている」 —— **違う。** `main/preview.ts:22-27` で
  `sandbox` / `contextIsolation` / `nodeIntegration` を明示している。
