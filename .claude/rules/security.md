---
paths:
  - "src/main/**"
  - "src/preload/**"
  - "src/shared/hooks.ts"
  - "src/shared/links.ts"
  - "src/shared/forge.ts"
  - "src/shared/wakeup.ts"
  - "src/renderer/src/components/Mermaid.tsx"
  - "test/surface.test.ts"
  - "test/main-trust.test.ts"
  - "test/hooks.test.ts"
  - "test/links.test.ts"
  - "test/main-git-credentials.test.ts"
---

# セキュリティ

敵として置いたのは、注入されたエージェント・信頼できないリポジトリ・同じユーザーの他プロセス。関所、リンク、preload、起床、鍵、askpass、注入口。

## 26. セキュリティの見直し（2026-09-08）

コードを一通り読んで見つけたものを、深刻な順に直した。想定利用者は作者ひとりで
renderer は信頼できるので、敵として置いたのは次の 3 つである。

- 読ませたファイルや Web 経由で**プロンプト注入されたエージェント**
- clone してきた**信頼できないリポジトリ**
- 同じユーザーで動く**他のプロセス**

| 何が | どこで | どうした |
| --- | --- | --- |
| リポジトリを開くだけで `.claude/settings.json` の hook が走る | `src/main/claude/trust.ts` | 信頼していない場所に hook があれば**起動前に止める** |
| LLM が書いたリンクのスキームを絞らず `shell.openExternal` に渡していた | `src/shared/links.ts` | http / https / mailto だけ外に出す |
| preload が main の `process.env` を丸ごと renderer に晒していた | `src/preload/index.ts` | `electronAPI` を出さない。`sandbox: false` も外した |
| エージェントが `wakeups.json` に自分の起床を書き足せた | `src/main/wakeup.ts` | このプロセスが作ったか読んだ id だけ起こす |
| 起床やループの送信を `origin: human` にしていた | `src/main/claude/session.ts` | `send()` が出どころを受け取る。偽らない |
| 人（管理者）のトークンをアプリが持っていた | `src/main/forge/setup.ts` | `izuna` というボットの利用者を作り、その鍵を持つ |
| ROOT_URL が LAN のアドレスになるとトークンが平文で流れる | `src/shared/forge.ts` | ループバックか https でなければ送らない |
| askpass が固定パスで、既存ファイルなら権限が付かなかった | `src/main/git/remote.ts` | `mkdtemp` で毎回作り、使い終わったら消す |
| 記録の「保存先」の印を検証せず任意のファイルを読んでいた | `src/main/sessions.ts` | `~/.claude/projects/` の下だけ読む |
| 雛形のままの entitlements と publish 先 | `build/entitlements.mac.plist`, `electron-builder.yml` | `allow-dyld-environment-variables` と `publish`、使わないカメラ・マイクの文言を消した |

### 開く前に hook を数える

ターミナルの Claude Code は初回に「このフォルダを信頼するか」を聞く。
SDK 経由には**その関所が無い**。`settingSources` に `project` があれば、
開いたリポジトリの `.claude/settings.json` の `SessionStart` や `PreToolUse` が
ログインシェルの環境変数つきで走る。

**hook が無ければ何も聞かない。** 毎回聞くと、いずれ全部「はい」になる。
hook があって、`~/.izuna/config.json` の `trustedRepos`（前方一致）に無ければ止める。
止めるときは、どのファイルのどのイベントか、どうすれば通るかを言う。
**壊れた JSON は「hook 無し」にしない** —— わざと壊せば通り抜けられる。

読む出どころは `register.ts` に決め打ちだったものを設定から引くようにした。
設定に `settingSources` があるのに使われていなかった。

### 出どころを偽らない

`send()` は全部を `origin: { kind: 'human' }` で送っていた。起床の予約も、
自律ループの反復も、CLI からは人の打鍵に見えていた。SDK の型には
`task-notification`（`scheduled-trigger`）と `auto-continuation` があるので、それを使う。
**CLI がこれをどう扱うかは未検証。** 人の入力を根拠にする判断（`isHuman()`）が
厳しくなる可能性はあるが、偽って通すほうが悪い。

### 人の鍵をアプリが持たない

`forgejo admin user generate-access-token` は CLI で発行できるのに CLI で失効できない（§7）。
管理者の鍵をアプリが持つと、消す手段が人のクリックしか無い鍵がアプリの中に残る。
gh-radar と同じく、**作業場を触るのはボット、承認するのは人**に分ける。
ボットは `izuna`、パスワードは乱数で捨てる（使わない）。

**既にある sandbox はボットから見えない。** `ensureRepo` は次に使うとき
ボットの下に作り直す。古いものは Forgejo の画面で消すか、ボットを協力者に足す。

### 直せなかったもの

`pnpm audit` の high 1 件（`extract-zip` <=2.0.1、GHSA-jmr9-qjv8-65gv）。
advisory は `>=2.0.2` で直ると言うが、**2.0.2 は npmjs に無い**（最新は 2020-06 の 2.0.1。
2026-09-08 に確認）。override は `ERR_PNPM_NO_MATCHING_VERSION` で入らない。
使うのは `electron` のインストーラだけで、製品には入らない。

### 確かめていないこと

- `sandbox: true` の preload で実機が動くか（`pnpm build` の出力を起動して見る）
- `auto-continuation` / `scheduled-trigger` の origin を CLI がどう扱うか
- 「引数に置くと `ps` で見える」という `remote.ts` の註 —— この macOS で `ps -E` を試した限り、
  他プロセスの環境変数は見えなかった。環境変数で渡す方針自体は問題ない

### 門は全部の webContents にかける（2026-09-08、docs/NIMBALYST.md §3 の 6）

`main/index.ts` は `app.on('web-contents-created')` で全部の webContents に同じ門をかける。
窓ごとに付けると、付け忘れた窓が素の Electron の挙動になる。加えて
**自分の origin と同じ http は外に出さない**（`shared/links.ts` の `shouldOpenOutside`）。
本文の相対リンクは dev では dev サーバの URL に解決され、ブラウザに渡すと真っ白なページが開く。
Nimbalyst の `windowOpenGuard.ts` と同じ判断。

### Izuna 自身が hook を持つ（2026-09-08）

`scripts/commit-gate.mjs` を `.claude/settings.json` の `PreToolUse`（matcher: Bash）から呼ぶと、
エージェントがコミットする直前に `pnpm verify` が回る。**これは §26 の関所が数える hook である。**
Izuna で Izuna を開くには `~/.izuna/config.json` の `trustedRepos` にこのリポジトリを足す。
関所が自分にも効いている証拠であって、例外ではない。settings.json は人が置く。

### 配るための固め（2026-09-09）

作者ひとりの道具から配るものに改めた（docs/GOAL.md）ので、他人の Mac で動く前提で見直した。

| 何 | どこ | 中身 |
| --- | --- | --- |
| renderer の砂場を明示 | `main/index.ts` | `sandbox: true` / `contextIsolation: true` / `nodeIntegration: false` を書く。既定に頼ると Electron の版で変わったときに気づけない |
| 頁からの権限要求とダウンロードを断る | `main/index.ts` | `defaultSession` と `persist:preview` の両方で `setPermissionRequestHandler` を false、`will-download` を止める。埋めた頁（§32）がカメラや通知を要求しても人に聞かない |
| Electron の fuses | `build/fuses.mjs`（`afterPack`） | RunAsNode / NODE_OPTIONS / --inspect を切り、asar の改竄検証と asar からしか読まないを入れ、Cookie を暗号化する |
| 署名と公証 | `electron-builder.yml`、`.github/workflows/release.yml` | 証明書（`MAC_CERT_P12`）と Apple ID が secrets にあるときだけ。無ければ署名無しの DMG。**証明書は人が用意する** |
| 秘密の走査 | `scripts/prepush.mjs`、`.github/workflows/security.yml` | gitleaks。pre-push は届けるコミットだけ、CI は履歴ごと。**gitleaks が無ければ push を止める**（無いことを緑で通さない） |
| 依存の脆弱性 | `osv-scanner.toml`、`security.yml` | osv-scanner。除外は理由付きで toml に（extract-zip の 2 件だけ） |
| Electron の設定の診断 | `security.yml` | Doyensec の electronegativity。指摘は artifact。門にはしない（誤検出が多い） |
| Claude Code の関所 | `shared/prereq.ts`、`main/claude/status.ts` | 入っているか・ログイン済みかを準備画面の先頭に出す。`claude auth status --json` の email / orgId は画面に持ち出さない |
| 貼られたトークン | `main/forge/setup.ts` の `adoptToken` | 通るか・ボット `izuna` のものかを聞いてから保管する。人の鍵は断る |
| 同梱プラグインは関所を通らない | `shared/plugin.ts`、`main/hub.ts`（2026-09-11） | 資料の skill は Izuna 自身が持ち込むので、リポジトリが持ち込む hook / MCP を数える関所（上）は通さない。**中身は版管理に入っていて、利用者が読める**（`resources/izuna-docs/`）。相手のリポジトリには何も置かないので、Izuna を消せば消える |
| 文面の鍵を伏せる | `shared/redact.ts`（2026-09-11） | `run()` の stderr と Forgejo の応答の本文に混ざった鍵の形（`sk-ant-`、`gh*_`、Authorization の値、JWT、PEM、URL の userinfo、`.env` の行）だけを伏せる。§27「stderr を捨てない」の逆側の穴。Orca の redactor の 1 段だけ（docs/ORCA.md §3） |
| 管理者のパスワードで作る | `main/forge/setup.ts` の `provisionBot`（2026-09-10） | CLI が無い構成でボットとトークンを API から作る。パスワードは 2 回の要求に載せて捨てる —— 保管せず、ログにも失敗の文面にも出さない。「人の鍵を置かない」は置かないことで、その場で使うことは Homebrew の形で CLI が管理者として動くのと同じ権限 |
| renderer を `app://` で配る | `shared/app-protocol.ts`、`main/protocol.ts` | `file://` で読むと file スキームに余計な権限が付く。独自スキーム（standard・secure）で出力ディレクトリの中だけを配り、fuse の `GrantFileProtocolExtraPrivileges` を切った。`isOwnPage` は `app:` を host で比べる |
| git の引数の注入 | `shared/remote.ts` の `isSafeRef` | `-` で始まるブランチ名は git がオプションとして読む。remote 名とブランチ名は形を見てから `--` で区切って渡す |
| CSP の締め | `src/renderer/index.html`、`harness.html` | `object-src` / `base-uri` / `frame-src` / `form-action` を `'none'`。`test/design-system.test.ts` が門 |
| 公開リポジトリの備え | `SECURITY.md`、`.github/dependabot.yml`、`LICENSE` | 報告先は Security Advisories。Dependabot は 7 日の cooldown（熟成の線より長く）。SDK と mermaid は人が上げる。MIT |

2026-09-09 の走査結果: gitleaks は 135 コミットで 0 件、osv-scanner は extract-zip の 2 件（既知・直せない）だけ。

### Forgejo を LAN に開き、測って閉じた（2026-09-10）

runner を回すために `app.ini` の `HTTP_ADDR` を `0.0.0.0` にした。根拠は `shared/forge.ts` に書いてあった
「コンテナはホストの 127.0.0.1 に届かない」だが、**それは測っていない前提だった**。同日の夜に測ると、
macOS の Docker Desktop / OrbStack では `host.docker.internal` がホスト側で中継され、127.0.0.1 に束ねた
Forgejo に runner からもジョブのコンテナからも届く（docs/ACTIONS.md § 壁 2 の表）。`127.0.0.1` に戻し、
push したジョブが `success` になるのを見た。開いていた約 1 時間、登録は閉じていて公開リポジトリは無く、
ファイアウォールは無効だった（ログイン画面と API が LAN に見えていた）。

いまは開いていれば準備画面が警告する（`openToLan`）。開く釦（`openAddr`）は消した。
runner のコンテナには `docker.sock` を渡している —— ホストの Docker を操作できる権限なので、
sandbox に置くのは信用できるリポジトリだけ。

---

## 36. 鍵を API に出さない覆い（2026-09-14）

### なぜ

利用者の要求はこれだった —— **「機密情報を API に入れないようにし、かつ claude に作業してもらいたい」。**

`gitleaks` は push の門で走っているが（`.githooks/pre-push`）、それが見ているのは
**GitHub へ出るもの**である。commit しない `.env` や `~/.config/gcloud/` の資格情報は、
`Read` した瞬間に API へ行く。**門が 1 つあることと、経路が塞がっていることは別だった。**

### 測ったこと（2026-09-14、`scripts/probe-mask.ts`。claude 2.1.266 / SDK 0.3.266）

作り物の鍵を置いた一時ディレクトリで、実 API を呼んで測った。

| 問い | 答え |
| --- | --- |
| `PostToolUse` の `updatedToolOutput` は効くか | **効く。** ブレインの `Read` も `Bash` も、モデルには札しか届かなかった |
| **実行役（サブエージェント）のツールでも鳴るか** | **鳴る**（`agent_id` 付き）。実行役も札しか見ない |
| `~/.claude/projects/*.jsonl` に残るのは | **差し替え後。** 生の鍵は 0 件、札が 7 行 |
| 経路の中に外の道具（ollama など）を置けるか | **置けない。** SDK の註に「非同期の hook の返事は、結果が固まったあとに届くので無視される」。同期で返しきる必要がある |

### 作ったもの

| どこ | 何 |
| --- | --- |
| `src/shared/mask.ts` | 純粋関数。型に当たった実値を `⟦IZUNA_SECRET_n⟧` に替え、戻す。**対応表はセッションの寿命だけで、ディスクに書かない** |
| `src/main/claude/session.ts` の `#hooks` | `PostToolUse` で `updatedToolOutput` を返す。**呼び手の hook（実行役の節目）は残す** |
| 同 `#restore` | 承認を許可したとき、実行する入力の札を実値に戻す |
| `src/shared/config.ts` の `maskSecrets` | 既定は `true`。切るのは人が書いたときだけ |

### 規律

- **書き換える hook は 1 つだけ。** SDK の註に「hook は元の出力に対して並行に走り、書き換えは最後に返したものが勝つ」とある。
  **恒等の書き換えを返さない** —— 鍵が無ければ何も返さないこと。返すと、並行する別の hook の伏せ字を消す
- **戻すのはツールの境界の 1 か所だけ。** `unmask` の呼び手を増やさない
- **人が見る札は札のまま。** 承認の画面にも会話にも実値を出さない（§26）。人は自分の機械の上にいるが、
  画面に出せば録画にもスクリーンショットにも残る
- **経路の中に機械学習を置かない。** 決定的な置換だけ。外の道具は、後から人に知らせる役にしか使わない

### 手すりであって境界ではない（実測で確かめた穴）

最初の走行で、エージェントが自分から `xxd out.txt` を実行した。**16 バイトごとに折り返された ASCII の欄には
鍵が途切れて出るので、型は当たらない。** 記録を `grep` しても生の鍵は 0 件だが、それは
「連続した文字列として無い」だけで、**符号化された形は API へ行っている。**

| 覆えるもの | 覆えないもの |
| --- | --- |
| ファイルやコマンドの出力に、その形のまま出た鍵 | `xxd` / `base64` / `od` のように**符号化された鍵** |
| 同じ実値が何度出ても、同じ札 | 人が入力欄に自分で貼り付けた鍵（`send()` は覆わない） |

**止まる場所は承認である。** `xxd out.txt` は `Bash` として人に上がるので、そこで拒否できる。
覆いは「うっかり読んでしまった」を減らすもので、**意図して取り出そうとする経路は塞げない**（規則 1）。

派生形（base64 と hex）も札に替える案は**取らなかった** —— 実際に踏んだ `xxd` の欄は 2 バイトごとに
空白が入るので連続した hex にならず、当たらない。当たらないものを足すと、**守られている幅を読み違える**。

### やっていない

- 人が入力欄に貼った字を覆うこと。**人が送ると決めたものを黙って書き換えない**
- 覆った数を画面に出すこと（`masked` の口は空けてある）。会話に札が出るので、いまは分かる
