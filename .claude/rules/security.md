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

敵として置いたのは、注入されたエージェント・信頼できないリポジトリ・同じユーザの他プロセス。関所、リンク、preload、起床、鍵、askpass、注入口。

## 26. セキュリティの見直し（2026-09-08）

コードを一通り読んで見つけたものを、深刻な順に直した。想定利用者は作者ひとりで
renderer は信頼できるので、敵として置いたのは次の 3 つである。

- 読ませたファイルや Web 経由で**プロンプト注入されたエージェント**
- clone してきた**信頼できないリポジトリ**
- 同じユーザで動く**他のプロセス**

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
| renderer を `app://` で配る | `shared/app-protocol.ts`、`main/protocol.ts` | `file://` で読むと file スキームに余計な権限が付く。独自スキーム（standard・secure）で出力ディレクトリの中だけを配り、fuse の `GrantFileProtocolExtraPrivileges` を切った。`isOwnPage` は `app:` を host で比べる |
| git の引数の注入 | `shared/remote.ts` の `isSafeRef` | `-` で始まるブランチ名は git がオプションとして読む。remote 名とブランチ名は形を見てから `--` で区切って渡す |
| CSP の締め | `src/renderer/index.html`、`harness.html` | `object-src` / `base-uri` / `frame-src` / `form-action` を `'none'`。`test/design-system.test.ts` が門 |
| 公開リポジトリの備え | `SECURITY.md`、`.github/dependabot.yml`、`LICENSE` | 報告先は Security Advisories。Dependabot は 7 日の cooldown（熟成の線より長く）。SDK と mermaid は人が上げる。MIT |

2026-09-09 の走査結果: gitleaks は 135 コミットで 0 件、osv-scanner は extract-zip の 2 件（既知・直せない）だけ。

### Forgejo を LAN に開いた（2026-09-10）

runner を回すため、作者の Mac の `app.ini` で `HTTP_ADDR` を `0.0.0.0` にした（控えは `app.ini.izuna-backup`）。
同じネットワークの端末から `:4649` に届く。ROOT_URL は `localhost` のままなので、Izuna がトークンを載せる
経路（`tokenMayTravel`）は変わらない。runner のコンテナには `docker.sock` を渡している ——
ホストの Docker を操作できる権限なので、sandbox に置くのは信用できるリポジトリだけ。

