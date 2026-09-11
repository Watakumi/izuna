/**
 * 対象を指して会話を始める（§34）。
 *
 * **Izuna は編集しない。** 指すのは人で、直すのはエージェントで、承認は人が持つ（規則 1）。
 * ここは入力欄に入れる文を作るだけの純粋関数（§4）。送るのは人が釦を押したとき。
 */

/** 作業ディレクトリからの相対。外のものは絶対のまま（`../../` を並べても読めない） */
export function relativeTo(cwd: string, path: string): string {
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

/** ファイル全体を指す */
export function mentionFile(cwd: string, path: string): string {
  return `${relativeTo(cwd, path)} について: `
}

/**
 * 行を指す。1 行なら `:12`、範囲なら `:12-20`。
 * 与えられた順に関わらず小さいほうを先に書く（選ぶ向きで文が変わらない）
 */
export function mentionLines(cwd: string, path: string, a: number, b: number): string {
  const from = Math.min(a, b)
  const to = Math.max(a, b)
  const at = from === to ? `${from}` : `${from}-${to}`
  return `${relativeTo(cwd, path)}:${at} について: `
}

/** 差分を指す。どの版の差分かは会話の文脈にあるので、ここでは言わない */
export function mentionDiff(cwd: string, path: string): string {
  return `${relativeTo(cwd, path)} の差分について: `
}

/**
 * いま入力欄にあるものへ足す。
 *
 * **打ちかけの文を捨てない。** 空なら入れるだけ、書きかけがあれば行を変えて足す。
 * 同じものを 2 度足さない（続けて押しても増えない）。
 */
export function appendMention(prompt: string, mention: string): string {
  if (prompt.trim() === '') return mention
  if (prompt.includes(mention.trimEnd())) return prompt
  return `${prompt.replace(/\s+$/, '')}\n${mention}`
}
