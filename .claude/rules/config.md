---
paths:
  - "src/shared/config.ts"
  - "src/main/config.ts"
  - "src/main/repos.ts"
  - "src/main/forge/**"
  - "src/shared/forge.ts"
  - "test/config.test.ts"
  - "test/main-files.test.ts"
  - "test/forge.test.ts"
  - "test/main-forge-*.test.ts"
---

# 設定

`~/.izuna/config.json` と決め打ちの扱い。壊れた設定で起動不能にしない。

## 15. 設定と汎用性（2026-09-07）

### 決め打ちを 3 種類に分けて扱う

| 種類 | 例 | 扱い |
| --- | --- | --- |
| **意図的に切った** | macOS 専用 / Claude Code 専用 / Forgejo と GitHub のみ | `docs/GOAL.md` の「やらないこと」。直さない |
| **他人の環境で壊れる** | Forgejo のパス、`brew`、探索先、remote 名 | `~/.izuna/config.json` で上書きできるようにした |
| **自分も踏むバグ** | `base: 'main'` の決め打ち、`origin/HEAD` | **検出に変えた**（下） |

### 置き場所が 2 つある（混同しやすい）

| 何 | どこ | 理由 |
| --- | --- | --- |
| 設定・共有フォルダ | `~/.izuna/config.json`、`~/.izuna/teams/` | 人が開いて編集するもの。見える場所に置く |
| **Forgejo のトークン** | **`app.getPath('userData')/forge-token.bin`** | `safeStorage` で暗号化する。人が触るものではない |

macOS の実体は `~/Library/Application Support/izuna/forge-token.bin`。
**`~/.izuna/` を見てもトークンは無い**（実際にここで一度間違えて
「未発行」と報告した）。`safeStorage` が使えない環境では**保管を拒む** ——
平文で置くくらいなら毎回入れてもらうほうがよい。

`userData` の名前は開発時が `package.json` の `name`（`izuna`）、
配布時が `electron-builder.yml` の `productName`（`Izuna`）で**食い違う**。
macOS の既定のファイルシステムは大小を区別しないので同じ場所になるが、
大小を区別するボリュームでは別扱いになる（**未検証**）。

### `~/.izuna/config.json`

無くても動く。**他の環境に合わせるための逃げ道**であって、用意しないと
使えないものではない。書式は `shared/config.ts`（純粋関数・検査済み）。

```jsonc
{
  "forgejoWorkPaths": ["/opt/homebrew/var/forgejo"],  // Docker なら [] にして下を書く
  "forgejoUrl": null,                                  // app.ini が読めないとき
  "sandboxRemote": "forgejo",                          // sandbox の remote 名
  "repoRoots": ["~/work", "~/src"],                    // 探索先
  "repoDepth": 3,
  "claudePath": null,                                  // PATH に無い場所に置いているとき
  "settingSources": ["project", "local"],              // §13
  "trustedRepos": []                                   // hook があっても聞かずに開く場所（前方一致）。§26
}
```

**壊れた設定でアプリを起動不能にしない。** 型の合わない値は既定に倒し、
**何を落としたかを名指しする** —— 黙って倒すと、直したのに効かない理由が
分からなくなる。設定画面の下に出る。

`repoDepth` は 1〜6 に制限する。ホーム全体を舐めさせない。

### 既定ブランチを決め打たない

`base: 'main'` と書いていた。`master` や `develop` のリポジトリで PR が
作れなくなる（**自分も踏む**）。`defaultBranch(cwd, remote)` に変えた。

1. `refs/remotes/<remote>/HEAD` を見る（ネットワークに出ない）
2. 無ければ `git remote show <remote>` に聞く
3. それでも駄目なら null。**`main` に倒さない**

`origin/HEAD` の決め打ちも同じ理由でやめ、検出した upstream の remote 名と
既定ブランチを組んで使う。

### 手元に `forgejo` が無い構成（2026-09-09）

`forgejoWorkPaths` を空にして `forgejoUrl` を書けば、`gatherFacts` は binary 無しでも応答と
トークンを調べ、`remote: true` を立てる。CLI を使う修正（ボットの作成・トークンの発行・
app.ini の書き換え）は出さず、トークンは人が Forgejo で作って準備画面に貼る（`adoptToken`。
通るか・ボット `izuna` のものかを聞いてから保管する）。手順は docs/SETUP.md。

### まだ残っている決め打ち

- `brew install` / `brew services`（Homebrew 以外の導入方法は docs/SETUP.md で人がやる）
- `/opt/homebrew/bin/claude` などのフォールバック（`claudePath` で回避可能）
- GitHub のホスト名一覧（GitHub Enterprise は未対応）
