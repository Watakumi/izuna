// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Settings } from '../../src/renderer/src/components/Settings'
import type { ThemeChoice } from '../../src/shared/ghostty'

afterEach(cleanup)

let current: ThemeChoice = { kind: 'ghostty' }
let available: string[] = []
let chosen: ThemeChoice[] = []
let fails = false

beforeEach(() => {
  current = { kind: 'ghostty' }
  available = []
  chosen = []
  fails = false
  ;(window as unknown as { izuna: unknown }).izuna = {
    themes: async () => {
      if (fails) throw new Error('設定が壊れています')
      return { current, available }
    },
    setTheme: async (c: ThemeChoice) => {
      chosen.push(c)
      return null
    }
  }
})

/** 配色を選ぶ（§37）。押した結果はその場に出る */
describe('設定', () => {
  it('選んでいるものに印が付く', async () => {
    render(<Settings onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Ghostty に合わせる')).toBeTruthy())
    expect(screen.getByText('選択中')).toBeTruthy()
    expect(screen.getByText('Izuna の既定')).toBeTruthy()
  })

  it('押すと設定に書き、**その場で何を選んだかを言う**', async () => {
    render(<Settings onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Izuna の既定')).toBeTruthy())
    fireEvent.click(screen.getByText('Izuna の既定'))
    await waitFor(() => expect(screen.getByText(/Izuna の既定にしました/)).toBeTruthy())
    expect(chosen).toEqual([{ kind: 'builtin' }])
  })

  it('自分で決めるときだけ 5 色を出す', async () => {
    render(<Settings onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('自分で決める')).toBeTruthy())
    expect(screen.queryByText('人の判断待ち')).toBeNull()
    fireEvent.click(screen.getByText('自分で決める'))
    await waitFor(() => expect(screen.getByText('人の判断待ち')).toBeTruthy())
    for (const w of ['地', '文字', '済んだこと', '壊れたこと'])
      expect(screen.getByText(w)).toBeTruthy()
    // 色を変えたら、その場で設定に書く（保存の釦は無い）
    fireEvent.change(screen.getAllByLabelText('色')[0], { target: { value: '#123456' } })
    await waitFor(() => expect(chosen.length).toBeGreaterThan(1))
    expect(chosen.at(-1)).toMatchObject({ kind: 'custom', colors: { background: '#123456' } })
  })

  it('**テーマが 1 件も無ければ、その節ごと出さない**（§35）', async () => {
    render(<Settings onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Izuna の既定')).toBeTruthy())
    expect(screen.queryByLabelText('Ghostty のテーマ')).toBeNull()
  })

  it('あれば一覧から選べる', async () => {
    available = ['nord', 'notion']
    render(<Settings onClose={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('Ghostty のテーマ')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Ghostty のテーマ'), { target: { value: 'notion' } })
    await waitFor(() => expect(chosen).toEqual([{ kind: 'named', name: 'notion' }]))
  })

  it('読めなくても画面は出す。**黙って既定に倒さず、読めなかったと言う**', async () => {
    fails = true
    render(<Settings onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/設定を読めませんでした/)).toBeTruthy())
    expect(screen.getByText('Ghostty に合わせる')).toBeTruthy()
  })

  it('閉じる', async () => {
    let closed = 0
    render(<Settings onClose={() => closed++} />)
    await waitFor(() => expect(screen.getByText('閉じる')).toBeTruthy())
    fireEvent.click(screen.getByText('閉じる'))
    expect(closed).toBe(1)
  })
})
