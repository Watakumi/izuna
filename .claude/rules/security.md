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
