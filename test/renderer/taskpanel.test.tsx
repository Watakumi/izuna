// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TaskPanel } from '../../src/renderer/src/components/TaskPanel'
import type { TaskRun } from '../../src/shared/transcript'

vi.mock('mermaid', () => ({ default: { initialize: () => undefined, render: async () => ({ svg: '<svg/>' }) } }))
afterEach(cleanup)

const task = (o: Partial<TaskRun>): TaskRun => ({
  toolUseId: 't1', description: 'greet の検査を書く', subagentType: 'general-purpose', prompt: null,
  status: 'completed', blocks: [], lastTool: null, usage: null, summary: null, ...o
} as TaskRun)

/** 実行役の一覧。文は本文と同じ markdown で描く（2026-09-09 に生のまま出ていた） */
describe('実行役の文', () => {
  it('`code` と **強調** が markdown として描かれ、生の記号が残らない', () => {
    const { container } = render(<TaskPanel tasks={[task({
      blocks: [{ kind: 'text', text: '`test/math.test.ts` の先頭は **足していません**。' }],
      summary: '結果: `6bee832` のまま'
    })]} />)
    // 終わったものは畳まれている。見出しを押して開く
    fireEvent.click(screen.getByText('greet の検査を書く'))
    expect(container.querySelector('code')?.textContent).toBe('test/math.test.ts')
    expect(container.querySelector('strong')?.textContent).toBe('足していません')
    expect(container.textContent).not.toContain('`')
    expect(container.textContent).not.toContain('**')
    expect(screen.getByText('greet の検査を書く')).toBeTruthy()
  })

  it('要約が最後の発話と同じ文なら二重に出さない', () => {
    const { container } = render(<TaskPanel tasks={[task({
      blocks: [{ kind: 'text', text: '終わりました。`a.ts` を書きました' }],
      summary: '終わりました。`a.ts` を書きました'
    })]} />)
    fireEvent.click(screen.getByText('greet の検査を書く'))
    expect(container.querySelectorAll('code').length).toBe(1)
  })

  it('依頼文も markdown で描く', () => {
    const { container } = render(<TaskPanel tasks={[task({ status: 'running', prompt: 'あなたは実行役 A です。`src/greet.ts` を見てください' })]} />)
    expect(container.querySelector('code')?.textContent).toBe('src/greet.ts')
  })
})
