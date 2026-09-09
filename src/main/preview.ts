import { WebContentsView, type BrowserWindow, type Rectangle } from 'electron'

/**
 * 頁を窓の中に埋めて見せる（§32）。PR の頁を Izuna から出ずに読むためのもの。
 *
 * `WebContentsView` を 1 枚だけ持つ。`<webview>` タグは使わない —— Electron が
 * 勧めておらず、renderer に別の webContents を生む口を渡すことになる。
 * 置く場所は renderer が測って送ってくる（`previewBounds`）。renderer の上に
 * 重なるので、枠の位置がずれたら renderer が送り直す。
 *
 * 埋めた頁は別の webContents なので、`main/index.ts` の門（全部の webContents に
 * かける）がそのまま効く。行き先は `shared/links.ts` の `canPreview` が絞る（呼ぶのは register）。
 * node は切り、sandbox にする。ログインは頁の側が持つ（`persist:preview` に残る）。
 */
let view: WebContentsView | null = null
let owner: BrowserWindow | null = null

export function openPreview(win: BrowserWindow, url: string, bounds: Rectangle): void {
  if (!view || owner !== win) {
    closePreview()
    view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'persist:preview'
      }
    })
    win.contentView.addChildView(view)
    owner = win
  }
  view.setBounds(bounds)
  if (view.webContents.getURL() !== url) void view.webContents.loadURL(url)
}

export function movePreview(bounds: Rectangle): void {
  view?.setBounds(bounds)
}

export function closePreview(): void {
  if (view && owner && !owner.isDestroyed()) owner.contentView.removeChildView(view)
  if (view && !view.webContents.isDestroyed()) view.webContents.close()
  view = null
  owner = null
}
