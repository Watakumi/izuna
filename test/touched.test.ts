import { describe, expect, it } from 'vitest'
import { touchedFiles } from '../src/shared/touched'
import type { Block, TaskRun, Transcript } from '../src/shared/transcript'

/**
 * 触ったファイルの一覧に対する門。
 *
 * 人がここを開くのは**差分を見る前に何が変わったかを知るため**なので、
 * 「変えていないのに変えたと出る」のが一番まずい。
 * 拒否された呼び出しと、パスの取れない呼び出しを混ぜないことを見る。
 */

const tool = (
  name: string,
  input: unknown,
  state: Block extends { state: infer S } ? S : never = 'done'
): Block => ({ kind: 'tool', id: name + JSON.stringify(input), name, input, state, result: null })

const t = (blocks: Block[]): Transcript =>
  ({
    items: [{ kind: 'assistant', id: 'a', blocks }],
    draft: null,
    running: false,
    tasks: [],
    permissionMode: 'default',
    limits: null
  }) as unknown as Transcript

const task = (over: Partial<TaskRun>): TaskRun => ({
  taskId: 'x',
  toolUseId: null,
  description: '実行役',
  subagentType: 'general',
  prompt: null,
  status: 'completed',
  summary: null,
  lastTool: null,
  backgrounded: false,
  usage: null,
  blocks: [],
  ...over
})

describe('触ったファイル', () => {
  it('読みと書きを分ける', () => {
    const out = touchedFiles(
      t([tool('Read', { file_path: '/a.ts' }), tool('Edit', { file_path: '/b.ts' })])
    )
    expect(out.find((f) => f.path === '/a.ts')).toMatchObject({ read: 1, wrote: 0 })
    expect(out.find((f) => f.path === '/b.ts')).toMatchObject({ read: 0, wrote: 1 })
  })

  it('**書いたものを先に出す**（開く目的が「何が変わったか」だから）', () => {
    const out = touchedFiles(
      t([tool('Read', { file_path: '/a.ts' }), tool('Write', { file_path: '/z.ts' })])
    )
    expect(out.map((f) => f.path)).toEqual(['/z.ts', '/a.ts'])
  })

  it('同じファイルを何度触っても 1 行にまとめ、回数を数える', () => {
    const out = touchedFiles(
      t([
        tool('Read', { file_path: '/a.ts' }),
        tool('Read', { file_path: '/a.ts' }),
        tool('Edit', { file_path: '/a.ts' })
      ])
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ read: 2, wrote: 1 })
  })

  it('**拒否された呼び出しは触っていない**', () => {
    const out = touchedFiles(t([tool('Write', { file_path: '/a.ts' }, 'denied')]))
    expect(out).toEqual([])
  })

  it('走っている途中でも出す（終わるまで黙っていると何も見えない）', () => {
    const out = touchedFiles(t([tool('Edit', { file_path: '/a.ts' }, 'running')]))
    expect(out).toHaveLength(1)
  })

  it('ファイルを触らないツールは出さない', () => {
    const out = touchedFiles(t([tool('Bash', { command: 'ls' }), tool('Grep', { pattern: 'x' })]))
    expect(out).toEqual([])
  })

  it('パスの取れない入力は**推測で埋めない**', () => {
    const out = touchedFiles(
      t([
        tool('Read', {}),
        tool('Read', { file_path: '' }),
        tool('Read', null),
        tool('Read', { file_path: 42 })
      ])
    )
    expect(out).toEqual([])
  })

  it('notebook も拾う', () => {
    const out = touchedFiles(t([tool('NotebookEdit', { notebook_path: '/n.ipynb' })]))
    expect(out[0].path).toBe('/n.ipynb')
  })

  it('実行役が触った分も混ぜ、誰が触ったかを残す', () => {
    const out = touchedFiles(t([tool('Read', { file_path: '/a.ts' })]), [
      task({ subagentType: 'reviewer', blocks: [tool('Edit', { file_path: '/a.ts' })] })
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ read: 1, wrote: 1, by: ['reviewer'] })
  })

  it('実行役の名が無ければ説明で代える', () => {
    const out = touchedFiles(t([]), [
      task({
        subagentType: null,
        description: '差分を読む',
        blocks: [tool('Read', { file_path: '/a.ts' })]
      })
    ])
    expect(out[0].by).toEqual(['差分を読む'])
  })

  it('同じ実行役を二重に数えない', () => {
    const out = touchedFiles(t([]), [
      task({
        subagentType: 'r',
        blocks: [tool('Read', { file_path: '/a.ts' }), tool('Edit', { file_path: '/a.ts' })]
      })
    ])
    expect(out[0].by).toEqual(['r'])
  })

  it('何も触っていなければ空', () => {
    expect(touchedFiles(t([]))).toEqual([])
  })
})
