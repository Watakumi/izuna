import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 画面の言葉の門（ui.md §17.4「比喩を使わない」）。
 *
 * 2026-09-10 に画面の日本語 188 件を人が洗って比喩と標語を消した。人が洗ったものは戻る。
 * Orca の `verify-localization-*` が JSX の生文字と aria-label / placeholder / title を
 * 文言として数えるのを見て（docs/ORCA.md §4）、同じ範囲を機械で見ることにした。
 * 見るのは**禁止した語が戻っていないか**だけ。文言の良し悪しは人が読む。
 */
const ROOT = join(__dirname, '..')

/** §17.4 で消した語。足すときは、消した理由を同じ節に書いてから */
const FORBIDDEN: Array<[string, string]> = [
  ['起こす', 'セッションは「開く」'],
  ['起こし', 'セッションは「開く」'],
  ['畳む', 'worktree は「消す」'],
  ['畳め', 'worktree は「消せません」'],
  ['回す', 'ループは「始める」'],
  ['触って', 'ファイルは「読み書き」'],
  ['落とす', 'ドロップは「ドロップ」'],
  ['漏れ', '「Upstream に出ています」と事実で言う'],
  ['当たる', '一致する'],
  ['手を止め', '止まりました'],
  ['使い捨て', '標語。何が起きるかを言う'],
  ['荒れて', '標語（矢印が言っている）'],
  ['仕上がった', '標語（矢印が言っている）'],
  ['作業場', 'Sandbox'],
  ['出口', 'Upstream'],
  ['調べるだけ', '副題は置かない。釦と警告が言う'],
  ['がいません', '道具を人扱いしない']
]

/** 文言を持つファイル。renderer の全部と、main から画面に出る文を作る shared の 4 本 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}
const FILES = [
  ...walk(join(ROOT, 'src', 'renderer', 'src')),
  ...['teammate', 'forge', 'prereq', 'question'].map((n) => join(ROOT, 'src', 'shared', `${n}.ts`))
]

const JP = /[\u3040-\u30ff\u4e00-\u9fff]/
/** 註を剥がす。文言は文字列と JSX の本文にあり、註にはここで見ない語が出てよい */
const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/\s.*$/gm, '')

/** 日本語を含む文字列リテラルと JSX の本文を、ファイルと行つきで抜く */
function copyOf(file: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = []
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
  lines.forEach((l, i) => {
    if (!JP.test(l)) return
    const found = [
      ...l.matchAll(/'([^']*[\u3040-\u30ff\u4e00-\u9fff][^']*)'/g),
      ...l.matchAll(/"([^"]*[\u3040-\u30ff\u4e00-\u9fff][^"]*)"/g),
      ...l.matchAll(/`([^`]*[\u3040-\u30ff\u4e00-\u9fff][^`]*)`/g),
      ...l.matchAll(/>([^<>{}]*[\u3040-\u30ff\u4e00-\u9fff][^<>{}]*)</g),
      ...l.matchAll(/^\s*([^<>{}'"`]*[\u3040-\u30ff\u4e00-\u9fff][^<>{}'"`]*)\s*$/g)
    ]
    for (const m of found) out.push({ line: i + 1, text: m[1].trim() })
  })
  return out
}

describe('画面の言葉（§17.4）', () => {
  const all = FILES.flatMap((f) => copyOf(f).map((c) => ({ file: relative(ROOT, f), ...c })))

  it('文言を拾えている（拾えなければ門が空回りしている）', () => {
    expect(all.length).toBeGreaterThan(150)
  })

  it('消した語が戻っていない', () => {
    const hits = all.flatMap(({ file, line, text }) =>
      FORBIDDEN.filter(([w]) => text.includes(w)).map(
        ([w, instead]) => `${file}:${line} 「${text}」に「${w}」。代わりに: ${instead}`
      )
    )
    expect(hits, hits.join('\n')).toEqual([])
  })
})
