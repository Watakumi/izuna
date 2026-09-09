// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Preview } from '../../src/renderer/src/components/Preview'

afterEach(cleanup)

let calls: Array<[string, unknown[]]> = []
beforeEach(() => {
  calls = []
  ;(window as unknown as { izuna: unknown }).izuna = {
    previewOpen: async (...a: unknown[]) => {
      calls.push(['open', a])
    },
    previewBounds: async (...a: unknown[]) => {
      calls.push(['bounds', a])
    },
    previewClose: async () => {
      calls.push(['close', []])
    }
  }
})

/** 頁を窓の中で見る枠（§32）。場所を測って送るだけで、中身は描かない */
describe('頁の枠', () => {
  it('開くと URL と場所を送り、閉じると消してもらう', async () => {
    let closed = false
    const { unmount } = render(
      <Preview
        url="https://github.com/x/y/pull/1"
        onClose={() => {
          closed = true
        }}
      />
    )
    expect(screen.getByTitle('https://github.com/x/y/pull/1')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 0))
    const open = calls.find(([k]) => k === 'open')!
    expect(open[1][0]).toBe('https://github.com/x/y/pull/1')
    expect(open[1][1]).toMatchObject({ x: expect.any(Number), width: expect.any(Number) })
    fireEvent.click(screen.getByText('閉じる'))
    expect(closed).toBe(true)
    unmount()
    expect(calls.some(([k]) => k === 'close')).toBe(true)
  })

  it('Forgejo の頁にはログインの一言を出し、GitHub には出さない', () => {
    render(<Preview url="http://localhost:4649/izuna/x/pulls/1" onClose={() => undefined} />)
    expect(screen.getByText(/ログイン/)).toBeTruthy()
    cleanup()
    render(<Preview url="https://github.com/x/y/pull/1" onClose={() => undefined} />)
    expect(screen.queryByText(/ログイン/)).toBeNull()
  })

  it('「外で開く」はその URL へのリンク（main の門が既定のブラウザへ逃がす）', () => {
    const { container } = render(
      <Preview url="https://github.com/x/y/pull/1" onClose={() => undefined} />
    )
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://github.com/x/y/pull/1')
  })
})
