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
  ['がいません', '道具を人扱いしない'],
  ['盤面', '作業（盤は無い）'],
  ['札', '作業・セッションなど、指しているものを言う']
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

const all = FILES.flatMap((f) => copyOf(f).map((c) => ({ file: relative(ROOT, f), ...c })))

describe('画面の言葉（§17.4）', () => {
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

/**
 * 表記のゆれ（2026-09-14）。**文書と画面の両方**を見る。
 *
 * textlint の日本語技術文書の規則を 30 本に当てて測ったところ、220 件のうち約 84% が
 * この repo の書き方（行を折る、コードと表と引用が混ざる）に対する誤検出だった。
 * 本物のゆれは**この 2 組だけ**だったので、道具を入れずに門へ足す。
 *
 * 足すときは**測ってから**。数えもせずに並べた禁止語は、守るものが無いまま増える。
 *
 * **`` ` `` で囲んだところは見ない。** 規則を説明する文書は、間違った形を名指しできなければ
 * 書けない（この門を入れた 2026-09-14、`.claude/rules/testing.md` が自分の説明で落ちた）。
 */
/** `` ` `` で囲んだ語を落とす。例として名指しした間違った形を、間違いとして数えない */
const withoutCode = (line: string): string => line.replace(/`[^`]*`/g, '')

const VARIANTS: Array<[RegExp, string]> = [
  [/ユーザ(?!ー)/, 'ユーザー（長音を付ける）'],
  [/一つ/, '1 つ（数えられるものは算用数字）']
]

/** 日本語の文書。外に向く英語の文書（README.md・SETUP・SECURITY）は見ない（DECISIONS §20） */
const JA_DOCS = [
  ...readdirSync(join(ROOT, '.claude', 'rules'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(ROOT, '.claude', 'rules', f)),
  ...readdirSync(join(ROOT, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(ROOT, 'docs', f)),
  join(ROOT, 'CLAUDE.md'),
  join(ROOT, 'README.ja.md'),
  join(ROOT, '.claude', 'feedback.md')
]

describe('表記のゆれ', () => {
  it('文書を拾えている（拾えなければ門が空回りしている）', () => {
    expect(JA_DOCS.length).toBeGreaterThan(10)
  })

  it('日本語の文書にゆれが無い', () => {
    const hits = JA_DOCS.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          VARIANTS.filter(([re]) => re.test(withoutCode(line))).map(
            ([, instead]) =>
              `${relative(ROOT, f)}:${i + 1} 「${line.trim().slice(0, 40)}」→ ${instead}`
          )
        )
    )
    expect(hits, hits.join('\n')).toEqual([])
  })

  it('画面の文言にもゆれが無い', () => {
    const hits = all.flatMap(({ file, line, text }) =>
      VARIANTS.filter(([re]) => re.test(withoutCode(text))).map(
        ([, instead]) => `${file}:${line} 「${text}」→ ${instead}`
      )
    )
    expect(hits, hits.join('\n')).toEqual([])
  })
})
