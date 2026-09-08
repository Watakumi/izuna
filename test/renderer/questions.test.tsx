// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PermissionBar } from '../../src/renderer/src/components/PermissionBar'

// 描いたものは検査ごとに片付ける。残すと次の検査が前の要素を見つける
afterEach(cleanup)

/** エージェントの問いに人が答える（docs/NIMBALYST.md §3 の 2） */
const request = {
  id: 'p1', toolName: 'AskUserQuestion',
  input: { questions: [
    { question: 'どれにする？', header: '選択', options: [{ label: 'A', description: '速い' }, { label: 'B' }] },
    { question: '要るもの', options: [{ label: 'x' }, { label: 'y' }], multiSelect: true }
  ] }
}

const mount = (): { answers: unknown[]; denied: number } => {
  const got = { answers: [] as unknown[], denied: 0 }
  render(<PermissionBar request={request} onAllow={() => {}} onDeny={() => { got.denied++ }}
    onAnswer={(a) => got.answers.push(a)} />)
  return got
}

describe('問いの受け皿', () => {
  it('**問いは問いとして描く**。許可の釦は出さない', () => {
    mount()
    expect(screen.getByText('どれにする？')).toBeTruthy()
    expect(screen.getByText('速い')).toBeTruthy()
    expect(screen.queryByText('許可')).toBeNull()
  })

  it('全部に答えるまで「答える」は押せない', () => {
    const got = mount()
    const send = screen.getByText('答える') as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(screen.getByText('A'))
    expect(send.disabled).toBe(true)
    fireEvent.click(screen.getByText('x'))
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    expect(got.answers).toEqual([{ 'どれにする？': ['A'], '要るもの': ['x'] }])
  })

  it('単一選択は押し直せる。複数選択は足し引きできる', () => {
    const got = mount()
    fireEvent.click(screen.getByText('A'))
    fireEvent.click(screen.getByText('B'))
    fireEvent.click(screen.getByText('x'))
    fireEvent.click(screen.getByText('y'))
    fireEvent.click(screen.getByText('x'))
    fireEvent.click(screen.getByText('答える'))
    expect(got.answers[0]).toEqual({ 'どれにする？': ['B'], '要るもの': ['y'] })
  })

  it('**選択肢に無い答えも書ける**（無いと近いものを選んで嘘をつくことになる）', () => {
    const got = mount()
    const [first, second] = screen.getAllByPlaceholderText('その他（自由に書く）')
    fireEvent.change(first, { target: { value: 'C にする' } })
    fireEvent.change(second, { target: { value: 'z' } })
    fireEvent.click(screen.getByText('答える'))
    expect(got.answers[0]).toEqual({ 'どれにする？': ['C にする'], '要るもの': ['z'] })
  })

  it('答えないこともできる', () => {
    const got = mount()
    fireEvent.click(screen.getByText('答えない'))
    expect(got.denied).toBe(1)
  })

  it('形が違えば、ふつうの許可として描く', () => {
    render(<PermissionBar request={{ id: 'p2', toolName: 'Bash', input: { command: 'ls' } }}
      onAllow={() => {}} onDeny={() => {}} onAnswer={() => {}} />)
    expect(screen.getByText('許可')).toBeTruthy()
  })
})
