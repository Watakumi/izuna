import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * 頁の埋め込み（§32）。Electron の WebContentsView を差し替えて、渡しているものを見る。
 * 見たいのは、node を切って sandbox にしていること、1 枚だけ持つこと、閉じたら外すこと。
 */
let created: Array<{
  prefs: Record<string, unknown>
  bounds: unknown
  loaded: string[]
  closed: boolean
}> = []
let children: unknown[] = []

vi.mock('electron', () => ({
  WebContentsView: class {
    rec: { prefs: Record<string, unknown>; bounds: unknown; loaded: string[]; closed: boolean }
    webContents: {
      loadURL: (u: string) => Promise<void>
      getURL: () => string
      close: () => void
      isDestroyed: () => boolean
    }
    constructor(opts: { webPreferences: Record<string, unknown> }) {
      const rec = {
        prefs: opts.webPreferences,
        bounds: null as unknown,
        loaded: [] as string[],
        closed: false
      }
      this.rec = rec
      created.push(rec)
      this.webContents = {
        loadURL: async (u: string) => {
          rec.loaded.push(u)
        },
        getURL: () => rec.loaded.at(-1) ?? '',
        close: () => {
          rec.closed = true
        },
        isDestroyed: () => rec.closed
      }
    }
    setBounds(b: unknown): void {
      this.rec.bounds = b
    }
  }
}))

type Win = {
  isDestroyed: () => boolean
  contentView: { addChildView: (v: unknown) => void; removeChildView: (v: unknown) => void }
}
const win = (): Win => ({
  isDestroyed: () => false,
  contentView: {
    addChildView: (v: unknown) => {
      children.push(v)
    },
    removeChildView: (v: unknown) => {
      children = children.filter((c) => c !== v)
    }
  }
})

const load = async (): Promise<typeof import('../src/main/preview')> =>
  import('../src/main/preview')

beforeEach(() => {
  created = []
  children = []
  vi.resetModules()
})

describe('頁の埋め込み', () => {
  it('**node を切り sandbox にした** view を 1 枚作って窓に足し、URL を読ませて置く', async () => {
    const { openPreview } = await load()
    const w = win()
    openPreview(w as never, 'https://github.com/x/y/pull/1', {
      x: 10,
      y: 20,
      width: 300,
      height: 200
    })
    expect(created).toHaveLength(1)
    expect(created[0].prefs).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    })
    expect(created[0].prefs.partition).toBe('persist:preview')
    expect(children).toHaveLength(1)
    expect(created[0].loaded).toEqual(['https://github.com/x/y/pull/1'])
    expect(created[0].bounds).toEqual({ x: 10, y: 20, width: 300, height: 200 })
  })

  it('同じ窓で開き直しても view は増えない。同じ URL なら読み直さない、違えば読む', async () => {
    const { openPreview, movePreview } = await load()
    const w = win()
    openPreview(w as never, 'https://github.com/x/y/pull/1', { x: 0, y: 0, width: 1, height: 1 })
    openPreview(w as never, 'https://github.com/x/y/pull/1', { x: 0, y: 0, width: 2, height: 2 })
    openPreview(w as never, 'https://github.com/x/y/pull/2', { x: 0, y: 0, width: 3, height: 3 })
    expect(created).toHaveLength(1)
    expect(created[0].loaded).toEqual([
      'https://github.com/x/y/pull/1',
      'https://github.com/x/y/pull/2'
    ])
    movePreview({ x: 5, y: 5, width: 50, height: 50 })
    expect(created[0].bounds).toEqual({ x: 5, y: 5, width: 50, height: 50 })
  })

  it('閉じたら窓から外して webContents を閉じる。無いときに閉じても落ちない', async () => {
    const { openPreview, closePreview } = await load()
    closePreview()
    const w = win()
    openPreview(w as never, 'https://github.com/x/y/pull/1', { x: 0, y: 0, width: 1, height: 1 })
    closePreview()
    expect(children).toHaveLength(0)
    expect(created[0].closed).toBe(true)
    // 閉じたあとに開き直せば新しい view が作られる
    openPreview(w as never, 'https://github.com/x/y/pull/2', { x: 0, y: 0, width: 1, height: 1 })
    expect(created).toHaveLength(2)
    expect(children).toHaveLength(1)
  })
})
