# 公式のデスクトップアプリとの比較

Claude の公式デスクトップアプリ（Claude Desktop）の「Code タブ」と、`claude --desktop` について、Izuna と何が同じで、
何が Izuna に残り、何を取って何を取らないかを決めた記録。docs/NIMBALYST.md・docs/ORCA.md と同じく、
**機能の一覧ではなく、判断の一覧**である（2026-10-07）。

**根拠の範囲を先に書く。** 手元の claude は 2.1.283 で、`--desktop` は 2.1.285 で足されたので**叩いていない**
（claude を上げるのは人。§10）。Code タブの画面も**開いて見ていない**。根拠にしたのは次の 3 つだけで、
画面で何が描かれ、何ができるかは、ここに書いた以上には分からない。

| 根拠 | 中身 |
| --- | --- |
| claude の変更履歴（2.1.267〜2.1.292） | `pnpm run upstream` が出すもの。デスクトップアプリに触れた行を拾った |
| 手元のデスクトップアプリ | 版 2.26454.0。置き場（`~/Library/Application Support/Claude/`）のフォルダの**形と件数だけ**を見た。会話の中身は読んでいない |
| 外部の調査の要約 | 利用者が共有したもの（`--desktop`、Remote Control の `/btw`） |

---

## 1. 何が同じか —— 作りが同じ

**Claude Desktop は、Izuna と同じく Agent SDK の上で Claude Code を動かしている。** 変更履歴はそれを
「SDK が載せているセッション（SDK-hosted sessions such as Claude Desktop）」と呼ぶ（2.1.282）。

| | Claude Desktop（Code タブ） | Izuna |
| --- | --- | --- |
| claude の動かし方 | Agent SDK。**Claude Code を同梱**（置き場の `claude-code/` は 2.1.289。手元の CLI より新しい） | Agent SDK。利用者が入れた claude を使う（`main/claude/locate.ts`） |
| 会話・承認・サブエージェント | Code タブで描く。サブエージェントの欄、Send now、権限モードの表示がある（変更履歴より） | 会話の柱・承認の札・実行役の欄（§12、§35） |
| セッションの再開 | `claude --desktop --continue` / `--resume <id>` で、端末のセッションをアプリで開ける（2.1.285） | `~/.claude/projects/` を走査して一覧から再開（§18） |
| 外から見る・頼む | Remote Control で、claude.ai・モバイルのアプリから載っているセッションに繋がる。`/btw` が進行中のターンを見る（2.1.285） | 無い |
| プラグイン・skill | Code タブで扱う。claude.ai の skill を `anthropic-skills:<名前>` で配る | 資料の skill を同梱して `--plugin-dir` で渡す（§33） |
| 管理 | Claude apps gateway のポリシーに `desktop` の鍵（`blockReadsOutsideWorkingDirectories`、`disableBypassPermissionsMode`）がある（2.1.281） | `~/.izuna/config.json` と §26 の関所 |

**会話の写しは持っていないように見える（未検証）。** `claude-code-sessions/` にあったのは予定実行の控え
（`scheduled-tasks.json`、125 バイト）だけだった。端末のセッションを `--resume <id>` でアプリから開けるので、
`~/.claude/projects/` を共有していると読むのが自然だが、確かめていない。

**「GUI で Claude Code を動かす」こと自体は、もう差ではない。** GOAL.md の「なぜ作るか」は 2026-09-07 の調査で
「公式デスクトップは worktree で対応、ブレイン主導と sandbox の分離が無い」と書いている。前者は今も同じ読みでよいが、
公式が SDK で同じ層に立っている以上、**会話の描画・承認・再開で勝負する理由は無い**。

## 2. Izuna に残る差

GOAL.md の三本の柱と、そのあと足したものに照らす。

| 差 | 残るか | 根拠 |
| --- | --- | --- |
| **Forgejo を sandbox にした二段の PR**（柱 2） | **残る** | claude の変更履歴（2.1.267〜2.1.292）に Forgejo / Gitea / self-hosted forge の行は 0 件。公式の出口は GitHub と claude.ai |
| ブレインと実行役、共有フォルダ（柱 1） | **未確認** | Code タブにサブエージェントはあるが、ブレインが実行役を worktree で並べて統率するかは分からない |
| 会議（§39） | **残る**（いまのところ） | 立場を決めた複数のエージェントに話させて議事録を残す機能は、変更履歴に無い |
| 承認を人が持つ（規則 1） | **差ではなく前提** | 公式も既定は手で承認。ただし既定が `auto` に寄っている（下の §4） |
| `/` コマンドの横断（§1） | **未確認** | Code タブのパレットを見ていない |
| 自分の Forgejo を持つ人のための道具（GOAL「誰のための道具か」） | **残る** | 公式は不特定多数で、self-hosted forge を前提にしない |

**差の芯は、相変わらず柱 2 である。** GOAL.md が「空いているのは sandbox の分離」と書いたとおりで、
公式が SDK の上で GUI を持ったことで、それ以外の層はむしろ公式と重なる。

## 3. 取るもの・取らないもの

| 何 | 取るか | なぜ |
| --- | --- | --- |
| 権限モードを既定に預けない | **取った**（#78） | 公式の流れは「設定が無ければ `auto`」（下）。Izuna は必ず `default` を渡す |
| 端末 ⇄ アプリの行き来（`--desktop --resume`） | **取らない**（いまは） | Izuna は `~/.claude/projects/` を走査するので、端末で始めたセッションは既に一覧に出る（§18）。逆向き（Izuna → 端末）は `claude --resume <id>` で足りる |
| 外から見る・頼む（Remote Control、モバイル） | **保留** | 承認待ちを外へ知らせる流れ（Orca のモバイル、Coucou、herdr の印）は強い。Izuna は通知・Dock・題名までは出す（§29、§17.3）。スマホから承認させるかは規則 1 に触れるので、別に決める |
| Claude Code を同梱する | **取らない** | 版を Izuna が決めると、利用者の claude と食い違う。Izuna は利用者の claude を使い、版の門（§10）で測った版との差を見張る |
| 管理のポリシー（`disableBypassPermissionsMode` など） | **取らない** | 組織の管理者向け。Izuna の利用者は 1 人で、自分の設定を自分で決める |

## 4. この比較で分かった、Izuna に効く上流の変化

変更履歴から拾った。どれも Izuna の規則に触れる。

| 版 | 変化 | Izuna への効き |
| --- | --- | --- |
| 2.1.284 | 対話のセッションは、権限モードが設定されていなければ `auto` で始まる（`permissions.defaultMode` が上書き） | Izuna は SDK 経由なので直接は当たらないが、流れは同じ方向 |
| 2.1.285 | `claude -p` と Python の Agent SDK も、テレメトリが切れていれば同じく `auto` で始まる | 外部の調査は TypeScript の SDK 0.3.286 でも同じと言う（未検証）。**#78 で `default` を必ず渡すようにした** |
| 2.1.285 | `claude --desktop` | 上の §3 |
| 2.1.282 | SDK が載せているセッション（Claude Desktop）で、使用量の確認に答えないとモデルが切り替わっていたのを、ターンを終える形に直した | Izuna も SDK が載せる側。同じ問いが Izuna に来たときの扱いは見ていない |

## 5. まだやっていないこと

- **`claude --desktop --resume <id>` を叩くこと。** claude を 2.1.285 以上に上げたら（#45 の catchup のあと）、
  Izuna で始めたセッションをアプリで開き、何が描かれ、承認がどちらに来るかを測る
- Code タブの画面を開いて、§2 の「未確認」（ブレインと実行役、`/` の横断）を埋める
- 会話の写しを本当に持たないか（`~/.claude/projects/` を共有しているか）を確かめる
