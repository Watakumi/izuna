/**
 * コミット文の下書き。
 *
 * ここはプロセスを知らない（§4 の原則）。
 * 「何を材料にするか」「返ってきたものをどう受け取るか」だけを決める。
 *
 * **差分の中身は渡さない**（2026-09-08 に Nimbalyst を読んで確かめた方針）。
 * 変更の意図は会話に出ていて、diff からは読み取れない。
 * 何百 KB もの差分を投げるより、**触ったファイルと会話**のほうが効く。
 */

export interface CommitContext {
  /** `git status --porcelain` の行 */
  changed: string[]
  branch: string | null
  /** 直近のコミット件名。書き方を揃えるため */
  recent: string[]
}

/** 材料が無ければ頼まない。空のコミット文を作らせない */
export function canDraft(context: CommitContext): boolean {
  return context.changed.length > 0
}

export function draftPrompt(context: CommitContext): string {
  return [
    'このセッションでの変更に対するコミット文を書いてください。',
    '',
    '## 変更されたファイル',
    '',
    ...context.changed.map((c) => `- ${c}`),
    '',
    ...(context.recent.length > 0
      ? ['## 直近のコミット（書き方を揃えるため）', '', ...context.recent.map((r) => `- ${r}`), '']
      : []),
    '## 決まりごと',
    '',
    '- **1 行目は件名。** 50 字前後で、何をしたかを言い切る',
    '- 2 行目は空ける',
    '- 3 行目以降に**なぜそうしたか**を書く。何をしたかは差分を見れば分かる',
    '- **この会話で分かったことを使う。** 差分からは読み取れない理由がそこにある',
    '- 前置きも後書きも要らない。**コミット文だけ**を返す'
  ].join('\n')
}

/**
 * 返ってきた本文からコミット文を取り出す。
 *
 * **囲みを外す。** モデルは頼まれなくても ``` で囲むことがあり、
 * そのまま渡すとコミット文に ``` が入る。
 */
export function extractMessage(text: string): string {
  const fenced = /```(?:\w+)?\n([\s\S]*?)```/.exec(text)
  const body = (fenced ? fenced[1] : text).trim()
  // 前置き（「はい、こちらです：」など）が付いていたら、空行までを落とす
  const lines = body.split('\n')
  const lead = lines.findIndex((l) => l.trim() === '')
  if (lead > 0 && lead < 3 && /[：:]\s*$/.test(lines[0].trim())) {
    return lines.slice(lead + 1).join('\n').trim()
  }
  return body
}
