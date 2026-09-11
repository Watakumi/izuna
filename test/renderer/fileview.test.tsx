// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FileView } from '../../src/renderer/src/components/FileView'

vi.mock('mermaid', () => ({ default: { initialize: () => {}, render: async () => ({ svg: '' }) } }))
afterEach(cleanup)

let text = ''
let truncated = false
let fail: string | null = null
let calls: string[] = []

beforeEach(() => {
  text = 'const a = 1\nconst b = 2\nconst c = 3\n'
  truncated = false
  fail = null
  calls = []
  ;(window as unknown as { izuna: unknown }).izuna = {
    readFile: async (cwd: string, path: string) => {
      calls.push(`${cwd}:${path}`)
      if (fail) throw new Error(fail)
      return { text, truncated, bytes: text.length }
    }
  }
})

/** ファイルを中で読む（§34）。**読むだけ。** 直すのはエージェント、指すのは人 */
describe('FileView', () => {
  it('中身を行番号つきで出し、パスは相対で出す', async () => {
    render(<FileView cwd="/w" path="/w/src/a.ts" onAsk={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('const b = 2')).toBeTruthy())
    expect(calls).toEqual(['/w:/w/src/a.ts'])
    expect(screen.getByText('src/a.ts')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('行を選ぶと、その行を指す文を足す。続けて押すと範囲になる', async () => {
    const asked: string[] = []
    const { container } = render(
      <FileView cwd="/w" path="/w/src/a.ts" onAsk={(m) => asked.push(m)} onClose={() => {}} />
    )
    await waitFor(() => expect(screen.getByText('const b = 2')).toBeTruthy())
    const line = (n: number): Element => container.querySelector(`[data-line="${n}"]`)!
    fireEvent.click(line(2))
    fireEvent.click(screen.getByText('2 行目について'))
    fireEvent.click(line(2))
    fireEvent.click(line(3))
    fireEvent.click(screen.getByText('2-3 行について'))
    expect(asked).toEqual(['src/a.ts:2 について: ', 'src/a.ts:2-3 について: '])
  })

  it('選んでいなければファイル全体を指す。**送りはしない**（足すだけ）', async () => {
    const asked: string[] = []
    render(<FileView cwd="/w" path="/w/src/a.ts" onAsk={(m) => asked.push(m)} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('const b = 2')).toBeTruthy())
    fireEvent.click(screen.getByText('このファイルについて'))
    expect(asked).toEqual(['src/a.ts について: '])
  })

  it('markdown は木で描き、「字で見る」で行が出る（木のままでは行を指せない）', async () => {
    text = '# 見出し\n\n本文\n'
    const { container } = render(
      <FileView cwd="/w" path="/w/README.md" onAsk={() => {}} onClose={() => {}} />
    )
    await waitFor(() => expect(screen.getByText('見出し')).toBeTruthy())
    expect(container.querySelector('[data-line="1"]')).toBeNull()
    fireEvent.click(screen.getByText('字で見る'))
    expect(container.querySelector('[data-line="1"]')).toBeTruthy()
    fireEvent.click(screen.getByText('木で見る'))
    expect(container.querySelector('[data-line="1"]')).toBeNull()
  })

  it('切ったことと、読めなかった理由をそのまま出す', async () => {
    truncated = true
    render(<FileView cwd="/w" path="/w/big.txt" onAsk={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('頭だけ')).toBeTruthy())
    cleanup()
    fail = '作業ディレクトリの外は読みません'
    render(<FileView cwd="/w" path="/etc/hosts" onAsk={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('作業ディレクトリの外は読みません')).toBeTruthy())
  })

  it('閉じられる', async () => {
    const closed: number[] = []
    render(<FileView cwd="/w" path="/w/src/a.ts" onAsk={() => {}} onClose={() => closed.push(1)} />)
    await waitFor(() => expect(screen.getByText('const b = 2')).toBeTruthy())
    fireEvent.click(screen.getByText('閉じる'))
    expect(closed).toEqual([1])
  })
})
