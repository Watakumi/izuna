---
paths:
  - "src/main/sessions.ts"
  - "src/shared/sessions.ts"
  - "src/shared/transcript.ts"
  - "src/renderer/src/useSessions.ts"
  - "src/renderer/src/components/NewSession.tsx"
  - "test/sessions.test.ts"
  - "test/main-sessions.test.ts"
  - "test/transcript.test.ts"
---

# セッションの保存と復元

保存層を自作しない。`~/.claude/projects/` を走査し、記録から会話を組み立て直す。

## 18. セッションの保存は自作しない（2026-09-07 実測）

### 気づいていなかったこと

「セッション保存の機能が無い」と思っていた。**間違いで、既に保存されている。**
`claude` は 1 セッション 1 ファイルで JSONL を書いている。

```
~/.claude/projects/<cwd のスラッグ>/<session-id>.jsonl
```

**Izuna が起こしたセッションも既に落ちていた**（`-private-tmp-izuna-probe`、
`…-T-izuna-cwd-*` など 7 本）。Izuna が知らなかっただけである。

この会話（19MB・6,000 行超）の実測:

| 種別 | 件数 | 使い道 |
| --- | --- | --- |
| `assistant` / `user` | 963 / 463 | 会話の復元 |
| `ai-title` | 366 | **CLI が付けた題名**。一覧のラベルが只で手に入る |
| `slug` | — | `happy-jingling-cherny` 形式のコードネーム（2.1.x） |
| `mode` / `permission-mode` | 各 367 | 復元時のモード |
| `file-history-snapshot` | 49 | ファイル編集のスナップショット |
| `attachment` | 2,540 | 途中で足された文脈（ツール追加・スキル一覧） |
| `last-prompt` / `queue-operation` | 367 / 40 | 直近プロンプトの栞・投入キュー |

サイドカーが 2 種類ある（このマシンには未出現・**未検証**）。

```
<sessionId>/subagents/agent-<id>.jsonl   実行役の記録
<sessionId>/tool-results/                外に出したツール結果
```

**`subagents/` が存在するなら、§12 の「まだ測っていないこと」の一部は
ファイルを読むだけで解ける。** 実行役を 1 本走らせて確かめること。

### 実装して分かったこと（2026-09-07）

**1. 人間の発話は素性で判定できない。**
最初 `origin.kind === 'human'` で判定して間違えた。CLI から打ったものには付くが、
**SDK 経由 —— つまり Izuna 自身が起こしたセッションでは `origin` が `null`**
（`promptSource: "sdk"` / `entrypoint: "sdk-cli"`）。
**一番見たいセッションだけ見出しが出ない**という形で出た。

素性ではなく**中身の形**で判ぐ。ツール結果を含まない `user` が発話である。
`test/sessions.test.ts` に回帰の門を置いた。

**2. 記録に思考は残っていない。**
`thinking` ブロックは 301 件すべて本文が空で、`signature` だけが残っていた。
CLI が保存時に落としている。そのまま復元すると**空の箱が数百個並ぶ**ので、
`replay` で捨てる。**復元した会話に思考は戻らない**（戻せない）。

**3. CLI が差し込んだ本文が見出しに漏れる。**
`<local-command-caveat>`（圧縮の注記）と `<command-name>`（スラッシュコマンドの
展開）。`isMeta` が付くものと付かないものがあるので、印だけに頼らず本文の頭も見る。

**4. 全文を読まない。** 一覧は頭と尻尾 64KB だけ読む。`cwd`・最初の発話・版は頭に、
`ai-title` と `slug` は尻尾にある。実測 45 件で **16ms**。
全文を読むのは復元のときだけ（19MB・6,922 行 → 495 item で 51ms）。

**5. 復元は main でやる。** 行のまま renderer に渡すと 19MB が IPC を通る。
`replaySession` は組み立て済みの `Transcript` を返す。

### 置き場所

```
src/shared/sessions.ts   要約・見出し・絞り込み・復元（純粋関数）
src/main/sessions.ts     ~/.claude/projects の走査。頭と尻尾だけ読む
test/sessions.test.ts    門 21 件。入力は**録画ではなく手で書いた**（§11 と同じ理由）
```

UI は**新しいツールバーを足していない**。`NewSession` の中に「続きから」を置いた ——
人が選ぶのは「新しく始めるか、続きか」であって、履歴という別の画面ではない。

### 決めたこと

**保存層を自作しない。走査する。** 理由は 3 つ。

1. 二重に持つと必ずずれる（§16 と同じ間違いになる）
2. ターミナルの `claude` で起こしたセッションも Izuna から見える
3. `ai-title` と `slug` があるので、題名を自前で生成しなくてよい

Nimbalyst も同じことをしている（`ClaudeCodeSessionScanner.ts`。コメントに
"discovers sessions created by the Claude Code CLI **or other tools**"）。

走査とパースは `shared/` の純粋関数に置く（§4 の原則）。**実 API が要らないので
門が作れる。** fixture は自分の `~/.claude/projects` から 1 本切り出す ——
ただし §11 と同じ理由で、**素の記録は私的な内容を含むので commit しない**。

### なぜこれを先にやるか

Izuna で Izuna を作ると、**直したものを見るのに必ず一度アプリを落とす**
（renderer は HMR、main は入れ替わらない。§7）。セッションが復元できないと
落とすたびに全部消えるので、dogfood の前提が成立しない。

### Issue は GitHub と Forgejo の両方から（2026-09-11）

それまで `NewSession` と `Inspector` は Issue を `gh`（GitHub）からしか読んでいなかった。GitHub を使わず
Forgejo だけで回している人には「最初の依頼」に何も出ない —— 対象は「自分の Forgejo を持つ人」なのに、
入口が GitHub 前提だった（利用者の指摘）。`forgeIssues`（`GET /repos/{o}/{r}/issues?state=open&type=issues`）を
足し、`shared/issues.ts` の `mergeIssues` が両方を出どころの札つきで並べる（GitHub を先に、番号の降順）。
片方だけでも出す。両方読めなければ「GitHub にも Forgejo にも繋がっていません」。番号は出どころごとに
独立なので、選択は `sameIssue`（出どころ + 番号）で比べる。依頼文は `issuePrompt` が出どころを言う。
