import { describe, expect, it, vi, beforeEach } from 'vitest'

/** OS の通知。Electron の Notification を差し替えて、渡しているものを見る */
let supported = true
let shown: Array<{ title: string; body: string }> = []
let clicks: Array<() => void> = []

vi.mock('electron', () => ({
  Notification: class {
    static isSupported(): boolean {
      return supported
    }
    #opts: { title: string; body: string }
    constructor(opts: { title: string; body: string }) {
      this.#opts = opts
    }
    on(_ev: string, fn: () => void): void {
      clicks.push(fn)
    }
    show(): void {
      shown.push(this.#opts)
    }
  }
}))

beforeEach(() => {
  supported = true
  shown = []
  clicks = []
  vi.resetModules()
})

describe('通知を出す', () => {
  it('題と本文を渡し、押されたら呼ぶ', async () => {
    const { notify } = await import('../src/main/notify')
    let clicked = 0
    expect(
      notify({ title: 't', body: 'b' }, () => {
        clicked++
      })
    ).toBe(true)
    expect(shown).toMatchObject([{ title: 't', body: 'b' }])
    clicks[0]()
    expect(clicked).toBe(1)
  })

  it('通知が使えない環境では黙って何もしない（アプリを止めない）', async () => {
    supported = false
    const { notify } = await import('../src/main/notify')
    expect(notify({ title: 't', body: 'b' })).toBe(false)
    expect(shown).toEqual([])
  })
})
