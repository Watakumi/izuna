# 資料の枠組み

PdM との会話や PJ の今後を決めるための資料を、Izuna から作る。**製品の機能ではなく skill**（`.claude/skills/doc-*`）で、
右パネルの「資料」タブか `/` パレットから頼む。出来た資料は `docs/plans/` に置かれ、sandbox の PR になり、
Forgejo の頁で PdM が読んでコメントできる（二段の流れに資料が乗る）。

## 入れたもの（2026-09-11）

| skill | 枠組み | 入力 | 出力 |
| --- | --- | --- | --- |
| `doc-now-next-later` | Now / Next / Later | Issue、GOAL、直近の commit | 3 列の表と「決めてほしいこと」 |
| `doc-impact-map` | Impact Mapping | 目標、Issue | mermaid の mindmap と表、「繋がらない」Issue |
| `doc-example-map` | Example Mapping | Issue 1 つ | 規則・具体例・疑問。具体例は検査に落とす |
| `doc-working-backwards` | Working Backwards（PR / FAQ） | GOAL、Issue、PR | プレスリリースと FAQ、「未定」 |

**版は資料ごとに個別に追える。** 置き場は `docs/plans/<資料名>/` で、skill は上書きせず日付つきの版を足し、
冒頭に前の版からの変更を書き、`README.md` に版の索引を置く（利用者の指示、2026-09-11）。歴史は
`git log -- docs/plans/<資料名>/`、PR は資料ごとに枝を切る（`docs/<資料名>`）。

どれも**推測で埋めない**。分からないものは「決めてほしいこと」「疑問」「未定」の節に残し、人が答える。
Issue は `gh` で読み、通らなければ人に貼ってもらう（Forgejo の Issue は Izuna の画面には出るが、skill からは
ボットのトークンに触れないので、貼ってもらう）。

## 選択肢として残しているもの

| 目的 | 枠組み | Izuna での向き不向き |
| --- | --- | --- |
| 見つける | ユーザーストーリーマッピング | 活動 × 優先度の表と mermaid。Issue と 7 手から作れる。**次の候補** |
| 見つける | Opportunity Solution Tree | 成果 → 機会 → 解決策 → 実験。Issue と会話から。mermaid |
| 見つける | Jobs to be Done / Job story | 利用者の定義から書き出す。表 |
| 見つける | カスタマージャーニーマップ | 7 手がそのまま段階になる。表 |
| 見つける | ペルソナ / 共感マップ | 入力が外にあり、根拠が薄くなりやすい |
| 決める | RICE / ICE | 費用は測れるが到達数と効果は推定 |
| 決める | Kano | 利用者への問いが要る。向かない |
| 決める | MoSCoW | GOAL の「やらないこと」が Won't |
| 決める | WSJF | 見積もりが要る |
| 固める | Event Storming | 本来は付箋の作業。コードと git log から起こせる |
| 固める | ストーリーの分割（SPIDR） | Issue 1 つを小さな PR の列に割る |
| 固める | Lean Canvas / Value Proposition Canvas | 入力が外 |
| 残す | 決定の表（選択肢・前提・効果・費用・覆る条件） | DECISIONS.md と同じ形。**次の候補** |
| 残す | Pre-mortem | 決める前の資料に 1 節 |
| 残す | DACI / RACI | 一人開発では要らない |
| 残す | Wardley Map | 描けるが判断の癖が要る |

## 他のリポジトリで使うには

skill は project スコープで読まれる（claude-cli.md §13）。使うリポジトリの `.claude/skills/` にこの 4 つを置く
（コピーかシンボリックリンク）。準備画面から入れる釦はまだ無い。

```bash
mkdir -p .claude/skills
for s in doc-now-next-later doc-impact-map doc-example-map doc-working-backwards; do
  ln -s ~/work/personal/izuna/.claude/skills/$s .claude/skills/$s
done
```
