// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { Conversation } from '../../src/renderer/src/components/Conversation'
import { ToolBlock } from '../../src/renderer/src/components/ToolBlock'
import { PermissionBar } from '../../src/renderer/src/components/PermissionBar'
import { Attachments, collectImages } from '../../src/renderer/src/components/Attachments'
import type { Block } from '../../src/shared/transcript'

// 描いたものは検査ごとに片付ける。残すと次の検査が前の要素を見つける
afterEach(cleanup)

const tool = (over: Partial<Extract<Block, { kind: 'tool' }>> = {}): Extract<Block, { kind: 'tool' }> => ({
  kind: 'tool', id: 't1', name: 'Bash', input: { command: 'ls' }, state: 'done', result: null, ...over
})

describe('会話', () => {
  it('空なら案内を出す', () => {
    render(<Conversation items={[]} draft={null} />)
    expect(screen.getByText('依頼を送ると、ここに会話が出ます')).toBeTruthy()
  })

  it('**送った画像は会話に残す**', () => {
    const { container } = render(<Conversation items={[
      { kind: 'user', id: 'u1', text: 'これ', images: [{ mediaType: 'image/png', data: 'AAAA', name: 'a.png' }] }
    ]} draft={null} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(container.textContent).toContain('これ')
  })

  it('知らせは調子で色を分ける。成功を警告の色で出さない', () => {
    const { container } = render(<Conversation items={[
      { kind: 'notice', id: 'n1', tone: 'bad', text: '壊れた' },
      { kind: 'notice', id: 'n2', tone: 'info', text: '済んだ' },
      { kind: 'notice', id: 'n3', tone: 'warn', text: '待って' }
    ]} draft={null} />)
    const colors = ['壊れた', '済んだ', '待って'].map((t) => (screen.getByText(t) as HTMLElement).style.color)
    expect(new Set(colors).size).toBe(3)
    void container
  })

  it('思考は畳んであり、開ける。空なら「返っていない」と言う', () => {
    render(<Conversation items={[{ kind: 'assistant', id: 'm1', blocks: [{ kind: 'thinking', text: '' }] }]} draft={null} />)
    expect(screen.queryByText('（要約は返っていません）')).toBeNull()
    fireEvent.click(screen.getByText('思考'))
    expect(screen.getByText('（要約は返っていません）')).toBeTruthy()
  })

  it('流れている途中は種類を言葉で出す', () => {
    const { rerender, container } = render(<Conversation items={[]} draft={{ messageId: 'm', index: 0, kind: 'thinking', text: '', toolName: null }} />)
    expect(container.textContent).toContain('考えています')
    rerender(<Conversation items={[]} draft={{ messageId: 'm', index: 0, kind: 'tool', text: '', toolName: 'Write' }} />)
    expect(container.textContent).toContain('Write を組み立てています')
    rerender(<Conversation items={[]} draft={{ messageId: 'm', index: 0, kind: 'text', text: '途中', toolName: null }} />)
    expect(container.textContent).toContain('途中')
  })

  it('本文とツールを並べる', () => {
    const { container } = render(<Conversation items={[
      { kind: 'assistant', id: 'm1', blocks: [{ kind: 'text', text: '**太字**' }, tool()] }
    ]} draft={null} />)
    expect(container.querySelector('strong')?.textContent).toBe('太字')
    expect(container.textContent).toContain('Bash')
  })
})

describe('ツールの札', () => {
  it('状態を言葉で出す。拒否は拒否と書く', () => {
    const { rerender, container } = render(<ToolBlock block={tool({ state: 'denied' })} />)
    expect(container.textContent).toContain('拒否しました')
    rerender(<ToolBlock block={tool({ state: 'error' })} />)
    expect(container.textContent).toContain('失敗')
    rerender(<ToolBlock block={tool({ state: 'running' })} />)
    expect(container.textContent).toContain('実行中')
  })

  it('Bash の終了コードを拾う', () => {
    const { container } = render(<ToolBlock block={tool({ result: 'done\nexit code: 1' })} />)
    expect(container.textContent).toContain('exit 1')
  })

  it('差分の無いものは畳んであり、開くと入力と結果が出る。長い結果は詰める', () => {
    const { container } = render(<ToolBlock block={tool({ result: 'x'.repeat(5000) })} />)
    expect(container.querySelector('pre')).toBeNull()
    fireEvent.click(screen.getByText('Bash'))
    const pres = container.querySelectorAll('pre')
    expect(pres).toHaveLength(2)
    expect(pres[0].textContent).toContain('"command": "ls"')
    expect(pres[1].textContent?.length).toBeLessThan(4100)
  })

  it('差分のあるものは開いて出す（承認したものを隠さない）', () => {
    const { container } = render(<ToolBlock block={tool({ name: 'Write', input: { file_path: '/a.ts', content: 'x' } })} />)
    expect(container.textContent).toContain('/a.ts')
    expect(container.textContent).toContain('+1')
  })
})

describe('承認', () => {
  const request = { id: 'p1', toolName: 'Write', input: { file_path: '/a.ts', content: 'x' }, description: '書きます' }

  it('許可と拒否を人が押す。実行役の要求でも人に上げる', () => {
    const answers: unknown[] = []
    render(<PermissionBar request={{ ...request, agentId: 'agent-123456' }}
      onAllow={(always) => answers.push(['allow', always])} onDeny={() => answers.push(['deny'])} />)
    expect(screen.getByText(/実行役 agent-/)).toBeTruthy()
    fireEvent.click(screen.getByText('許可'))
    fireEvent.click(screen.getByText('拒否'))
    expect(answers).toEqual([['allow', false], ['deny']])
  })

  it('CLI の提案があれば「このセッション中は許可」を出す', () => {
    const answers: unknown[] = []
    render(<PermissionBar request={{ ...request, suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] }}
      onAllow={(always) => answers.push(always)} onDeny={() => {}} />)
    fireEvent.click(screen.getByText('このセッション中は許可'))
    expect(answers).toEqual([true])
    expect(screen.getByText(/setMode · acceptEdits · session/)).toBeTruthy()
  })
})

describe('貼った画像', () => {
  it('無ければ何も描かない', () => {
    const { container } = render(<Attachments items={[]} rejected={[]} onRemove={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('控えを見せ、押せば外せる。**断った理由も出す**', () => {
    const removed: number[] = []
    const { container } = render(<Attachments items={[{ mediaType: 'image/png', data: 'AAAA', name: 'a.png' }]}
      rejected={['b.gif: 大きすぎます']} onRemove={(i) => removed.push(i)} />)
    expect(container.querySelector('img')).not.toBeNull()
    expect(container.textContent).toContain('b.gif: 大きすぎます')
    fireEvent.click(screen.getByTitle('a.png'))
    expect(removed).toEqual([0])
  })

  it('ファイルから読み、送れないものは理由にして返す', async () => {
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'ok.png', { type: 'image/png' })
    const svg = new File(['<svg/>'], 'no.svg', { type: 'image/svg+xml' })
    const { ok, bad } = await collectImages([png, svg])
    expect(ok).toHaveLength(1)
    expect(ok[0]).toMatchObject({ mediaType: 'image/png', name: 'ok.png' })
    expect(bad).toEqual(['no.svg: image/svg+xml は送れません（png / jpeg / gif / webp）'])
  })
})
