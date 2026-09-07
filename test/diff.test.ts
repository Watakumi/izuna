import { describe, expect, it } from 'vitest'
import { describeToolInput, diffFromToolInput } from '../src/shared/diff'

describe('ツール入力からの差分', () => {
  it('Write は全文が追加行になる', () => {
    const d = diffFromToolInput('Write', { file_path: '/tmp/a.txt', content: 'x\ny\n' })
    expect(d).toMatchObject({ path: '/tmp/a.txt', added: 2, removed: 0, whole: true })
    expect(d?.lines.map((l) => l.kind)).toEqual(['add', 'add'])
  })

  it('Edit は変わった行だけを出す', () => {
    const d = diffFromToolInput('Edit', {
      file_path: '/tmp/a.ts',
      old_string: 'const a = 1\nconst b = 2\nconst c = 3',
      new_string: 'const a = 1\nconst b = 99\nconst c = 3'
    })
    // 変わっていない行を削除・追加として出すと、承認のときに読めなくなる
    expect(d?.added).toBe(1)
    expect(d?.removed).toBe(1)
    expect(d?.lines.filter((l) => l.kind === 'same')).toHaveLength(2)
  })

  it('Edit の行番号が両側とも付く', () => {
    const d = diffFromToolInput('Edit', { file_path: 'a', old_string: 'p\nq', new_string: 'p\nr' })
    const same = d?.lines.find((l) => l.kind === 'same')
    expect(same).toMatchObject({ before: 1, after: 1 })
    expect(d?.lines.find((l) => l.kind === 'del')).toMatchObject({ before: 2, after: null })
    expect(d?.lines.find((l) => l.kind === 'add')).toMatchObject({ before: null, after: 2 })
  })

  it('MultiEdit は塊のあいだを区切る', () => {
    const d = diffFromToolInput('MultiEdit', {
      file_path: 'a',
      edits: [
        { old_string: 'a', new_string: 'A' },
        { old_string: 'z', new_string: 'Z' }
      ]
    })
    expect(d?.added).toBe(2)
    expect(d?.lines.some((l) => l.text === '⋯')).toBe(true)
  })

  it('差分の無いツールは null（失敗ではない）', () => {
    expect(diffFromToolInput('Bash', { command: 'ls' })).toBeNull()
    expect(diffFromToolInput('Write', {})).toBeNull()
    expect(diffFromToolInput('Write', null)).toBeNull()
  })
})

describe('承認バーの一行', () => {
  it('差分があればパスと増減', () => {
    expect(describeToolInput('Write', { file_path: '/tmp/a', content: 'x' })).toBe('/tmp/a  +1 −0')
  })

  it('Bash はコマンドを出す', () => {
    expect(describeToolInput('Bash', { command: 'pnpm test' })).toBe('pnpm test')
  })

  it('長いものは切る', () => {
    expect(describeToolInput('Bash', { command: 'x'.repeat(300) })).toHaveLength(161)
  })

  it('手がかりが無ければツール名', () => {
    expect(describeToolInput('Unknown', {})).toBe('Unknown')
  })
})
