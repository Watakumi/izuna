/**
 * 差分のレビューを頼む。
 *
 * ここはプロセスを知らない（§4 の原則）。作るのは文面だけである。
 *
 * **差分の中身をこちらで集めて渡さない。** エージェントは同じ作業ディレクトリに
 * いて `git` を持っているので、必要なところを自分で読む。
 * こちらで全部読んで渡すと、大きな差分では窓を本文で埋めてしまい、
 * **肝心の読む余地が無くなる**（`commit.ts` と同じ判断）。
 */

export interface ReviewContext {
  /** 見てほしい側 */
  head: string | null
  /** 比べる相手。分からなければ null */
  base: string | null
  /** PR の番号。会話から作る場合は null */
  pull: number | null
}

/** 比べる先が無ければ頼まない。**何と比べるのかが決まらない** */
export function canReview(context: ReviewContext): boolean {
  return context.head !== null && context.head !== '' && context.base !== null && context.base !== ''
}

export function reviewPrompt(context: ReviewContext): string {
  const range = `${context.base}...${context.head}`
  return [
    context.pull === null
      ? `${range} の差分をレビューしてください。`
      : `PR #${context.pull}（${range}）をレビューしてください。`,
    '',
    '## 進め方',
    '',
    `1. \`git diff ${range} --stat\` で全体の大きさを見る`,
    '2. 変更されたファイルを読む。**差分だけでなく周りも読む** —— ',
    '   呼び出し側を書き換えていないことは、安全の証拠ではない',
    '3. 見つけたものを、**再現する筋道つきで**書く',
    '',
    '## 見るもの',
    '',
    '- **壊れる筋道が言えるもの**を先に出す。「こう入力するとこう落ちる」まで書く',
    '- 文書と実装のズレ。書いてあるのに呼ばれていないものは、',
    '  守られていないより質が悪い（守られていると思わせる）',
    '- 検査の穴。**検査からしか呼ばれない実装**が増えていないか',
    '',
    '## 決まりごと',
    '',
    '- **直さない。** 見つけたものを言うところまで。直すかは人が決める',
    '- 場所は `ファイル:行` で書く',
    '- 確かめていない推測は、推測だと書く。断定と混ぜない',
    '- 見つからなければ「無い」と言う。**埋め草を出さない**'
  ].join('\n')
}
