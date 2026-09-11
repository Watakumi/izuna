# 資料の枠組み

PdM との会話や PJ の今後を決めるための資料を、Izuna から作る。**製品の機能ではなく skill**（`.claude/skills/doc-*`）で、
右パネルの「資料」タブか `/` パレットから頼む。出来た資料は `docs/plans/` に置かれ、sandbox の PR になり、
Forgejo の頁で PdM が読んでコメントできる（二段の流れに資料が乗る）。

## 書き方（2026-09-11 に作り直した）

最初は 1 本 60 行の単一ファイルで書いたが、利用者から**公開資料からエージェント用の手順書を作る方法**を
受け取って当て直した。工程は 3 段。

1. **書かれていない条件を洗い出す。** 依頼文の具体的な値を「変えられる条件」に読み替え、条件を変えて
   手順が変わるかを試し、**抜けると失敗すること**（間違えても止まらない箇所）を探す
2. **集めた記述を 3 つに仕分ける。** 一般ルール（裏づけ・矛盾なし・環境非依存の 3 条件を満たす）／
   範囲つきの例（環境非依存の根拠が無い。範囲を明記して残す）／不採用（書かない。判断だけ記録する）
3. **ファイルに配置する。** 本体は 7 項目（起動条件・手順の形式・実行できる指示・適用範囲・検証の方法・
   出力の約束・読み込みの順序）で 120〜130 行、裏づけは参照ファイル（`.claude/skills/doc-shared/`）へ

第 1 段階で測ったもの（`doc-shared/judgement.md` に全部ある）:

| 条件を変えると | 何が起きたか | 手順への反映 |
| --- | --- | --- |
| Issue が 0 件 | `gh issue list` は **`[]` を返して成功する** | **止まる判断**を手順 2 に置いた。止めないと空の表か作り話が出る |
| GitHub の remote が無い | `no git remotes found` で失敗する | 人に貼ってもらう |
| 日付を聞く | エージェントは知っていた（2026-09-11 と答えた） | それでも `date +%F` で確かめる。間違えても止まらない箇所なので |
| `doc-shared/` を置く | skill として走査されない（4 本だけが出る） | 参照ファイルの置き場にできる |

不採用にしたもの: 「Now は次の 1〜2 週間で終わるもの」（期間の根拠が無い。観測できる条件に書き直した）、
「Issue が 100 件を超えたら絞る」（上限の根拠が無い）。

**本体は 120〜130 行で、目安の 140〜160 行より短い。** 足りない分を埋めるために文を足すことはしない。

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
ボットのトークンに触れないので、貼ってもらう。Issue #52）。

4 本が共有する参照ファイルは `.claude/skills/doc-shared/` にある。

| ファイル | 中身 |
| --- | --- |
| `inputs.md` | 入力の集め方と、集まらないときの畳み方。`gh` が何を返すかの測定 |
| `versioning.md` | 版の付け方、置き場、確かめ方 |
| `writing.md` | 書いてはいけないこと、成功の定義、長さ |
| `judgement.md` | 一般ルール / 範囲つきの例 / 不採用 の判定の記録。再判定する条件 |

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

**`doc-shared` も一緒に入れる。** 4 本の本体がそこを参照している。

```bash
mkdir -p .claude/skills
for s in doc-shared doc-now-next-later doc-impact-map doc-example-map doc-working-backwards; do
  ln -s ~/work/personal/izuna/.claude/skills/$s .claude/skills/$s
done
```

`doc-shared` は `SKILL.md` を持たないので skill としては走査されない（2026-09-11 に確かめた）。
