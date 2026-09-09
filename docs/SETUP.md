# 他人の環境で Izuna を動かす

> Izuna は **自分の Forgejo を持っている人**のための道具である（docs/GOAL.md）。
> Forgejo が無い人は対象にしない。この文書は、作者以外の Mac で準備を通すための手順である。
> 手順の判定はアプリの「準備」画面が自動でやる。**変えるのは押したときだけ**。

## 要るもの

| 何                                            | なぜ                                                                              | 無いときの案内（準備画面に出る）                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| macOS（Apple Silicon か Intel）               | Electron の配布物は macOS だけ                                                    | ——                                                                      |
| **Claude Code**（`claude` CLI）にログイン済み | Izuna は手元の `claude` を子プロセスで動かす。API キーは使わない（CLAUDE.md §14） | `curl -fsSL https://claude.ai/install.sh \| bash` → `claude auth login` |
| **Forgejo**（自分のもの）                     | sandbox。実行役の成果はまず Forgejo で PR になる                                  | 下の 3 つのどれか                                                       |
| `gh` CLI にログイン済み                       | upstream（GitHub）の Issue と PR は `gh` に任せる                                 | `brew install gh` → `gh auth login`                                     |
| `git`                                         | ——                                                                                | Xcode Command Line Tools                                                |

## DMG を開く（署名していないあいだ）

配布物は Apple の証明書で署名していない（証明書は人が用意する。`.github/workflows/release.yml` は secrets を
置けば署名と公証まで動く）。署名の無いアプリは macOS が「開発元を確認できません」と言う。

| macOS | 開き方 |
| --- | --- |
| 14 まで | Finder で右クリック → 開く |
| 15 以降 | 一度開こうとして断られたあと、システム設定 → プライバシーとセキュリティ の一番下の「このまま開く」。ターミナルなら `xattr -dr com.apple.quarantine /Applications/Izuna.app` |

electron-builder が ad-hoc の署名を付けているので「壊れている」とは言われない。

## Forgejo の置き方は 3 つ

### 1. この Mac に Homebrew で（作者と同じ）

準備画面が全部やる。「Homebrew で入れる」→「起動する」→ ブラウザで初期設定 →「トークンを発行する」。
ボット `izuna` の作成とトークンの発行は `forgejo` の CLI で行うので、手元にバイナリがあるこの形だけで押せる。

### 2. この Mac に Docker で

`~/.izuna/config.json` に書く。

```jsonc
{
  "forgejoWorkPaths": [],
  "forgejoUrl": "http://localhost:3000/"
}
```

手元に `forgejo` の CLI が無いので、**ボットとトークンは人が Forgejo の画面で作る**。

1. Forgejo に `izuna` という利用者を作る（管理者でなくてよい）
2. `izuna` でログインし、設定 → アプリケーション → アクセストークンを作る。権限は `write:user` と `write:repository`（PR にコメントを付けるなら `write:issue` も）
3. Izuna の準備画面の「izuna のトークンを貼る」に貼って「保管する」

Izuna は貼られたトークンが**通るか・`izuna` のものか**を Forgejo に聞いてから保管する。
人（管理者）のトークンは受け取らない —— 人の鍵をアプリに置かない（CLAUDE.md §26）。

### 3. 別のマシンの Forgejo

2 と同じだが、**URL は https にすること**。http で LAN を通る経路には、Izuna はトークンを送らない
（準備画面の「経路」が赤になる）。自宅の LAN でも同じ。

## 準備画面で緑になるもの

上から順に潰す。任意の項目（Actions、runner）は数えない。

```
Claude Code   ✓ 2.1.263 · ~/.local/bin/claude
ログイン       ✓ claude.ai · max
Forgejo
インストール   ✓ 16.0.3 · /opt/homebrew/bin/forgejo      （Docker なら「設定の forgejoUrl を使う」）
初期設定       ✓ http://localhost:4649/ · …/app.ini
起動           ✓ 応答しました
トークン       ✓ write:user, write:repository
```

## 設定の場所

`~/.izuna/config.json`。無くても動く。書式は `.claude/rules/config.md`（§15）。

```jsonc
{
  "forgejoWorkPaths": ["/opt/homebrew/var/forgejo"], // Docker なら []
  "forgejoUrl": null, // app.ini が読めないとき
  "sandboxRemote": "forgejo", // sandbox の remote 名
  "repoRoots": ["~/work", "~/src"], // リポジトリの探索先
  "claudePath": null, // PATH に無い場所に claude を置いているとき
  "trustedRepos": [] // hook があっても聞かずに開く場所
}
```

## 開発者として動かす

```bash
brew install gitleaks     # pre-push の門。無いと push できない（秘密の走査は門である）
pnpm install
pnpm dev
pnpm verify               # 手元の claude の版が実測と違うと落ちる。CI と同じく IZUNA_CI=1 で外せる
```

## CI を自宅で回す（任意）

docs/ACTIONS.md。runner は Docker で動かし、`HTTP_ADDR` を LAN に開く判断が要るので、人がやる。
