import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../src/shared/patch'

/** Forgejo の PR 差分を読む（docs/NIMBALYST.md §7 の 3） */
const SAMPLE = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '+const c = 4',
  ' export {}',
  'diff --git a/new.md b/new.md',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/new.md',
  '@@ -0,0 +1,2 @@',
  '+# 題',
  '+本文',
  '\\ No newline at end of file',
  'diff --git a/img.png b/img.png',
  'Binary files a/img.png and b/img.png differ',
  ''
].join('\n')

describe('unified diff', () => {
  it('ファイルごとに分け、行番号と増減を数える', () => {
    const files = parseUnifiedDiff(SAMPLE)
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'new.md', 'img.png'])
    const a = files[0]
    expect(a).toMatchObject({ added: 2, removed: 1, whole: false })
    expect(a.lines.map((l) => [l.kind, l.before, l.after])).toEqual([
      ['same', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['add', null, 3],
      ['same', 3, 4]
    ])
  })

  it('新規ファイルは全文として印を付ける', () => {
    const n = parseUnifiedDiff(SAMPLE)[1]
    expect(n.whole).toBe(true)
    expect(n.lines.map((l) => l.text)).toEqual(['# 題', '本文'])
    expect(n.added).toBe(2)
  })

  it('バイナリは「ある」ことだけ出す', () => {
    const b = parseUnifiedDiff(SAMPLE)[2]
    expect(b.lines).toEqual([{ kind: 'same', text: '（バイナリ）', before: null, after: null }])
  })

  it('CRLF でも壊れない。空なら空', () => {
    expect(parseUnifiedDiff(SAMPLE.replace(/\n/g, '\r\n'))[0].added).toBe(2)
    expect(parseUnifiedDiff('')).toEqual([])
    expect(parseUnifiedDiff('ただの文\n')).toEqual([])
  })

  it('2 つ目の hunk で行番号を取り直す', () => {
    const two = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '@@ -10,2 +10,2 @@',
      ' k',
      '-l',
      '+m'
    ].join('\n')
    const f = parseUnifiedDiff(two)[0]
    expect(f.lines.at(-1)).toEqual({ kind: 'add', text: 'm', before: null, after: 11 })
  })
})
