import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerSessionIpc, stopAllSessions } from './ipc/register'
import { isOwnPage, openableOutside } from '../shared/links'

/** 通知の宛先。段3 で複数ウィンドウにするまでは 1 枚 */
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // Create the browser window.
  const win = new BrowserWindow({
    title: 'Izuna',
    width: 1280,
    height: 860,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
      // sandbox / contextIsolation / nodeIntegration は Electron の既定のまま。
      // preload は contextBridge と ipcRenderer しか使わないので、砂場の中で足りる
    }
  })

  mainWindow = win
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  /**
   * **外に出すのは http / https / mailto だけ。**
   *
   * `shell.openExternal` は `open` と同じで、`file:` や独自スキームは
   * アプリを起動する。本文のリンクは LLM が書くので、クリックで
   * 何が起動するかを本文に委ねない（`shared/links.ts`）。
   */
  const escape = (url: string): void => {
    if (openableOutside(url)) void shell.openExternal(url)
  }

  win.webContents.setWindowOpenHandler((details) => {
    escape(details.url)
    return { action: 'deny' }
  })

  /**
   * **アプリの窓が外部サイトに置き換わるのを防ぐ。**
   *
   * 会話の本文には LLM が書いたリンクが出る。`target="_blank"` なら上の
   * ハンドラを通って既定のブラウザに逃げるが、素の `<a href>` は
   * **この窓ごと遷移する**。そうなると戻る手段が無い（メニューも無い）。
   * 自前の画面（dev サーバと file://）以外への遷移は止めて、外に出す。
   */
  win.webContents.on('will-navigate', (event, url) => {
    if (isOwnPage(url, win.webContents.getURL())) return
    event.preventDefault()
    escape(url)
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('dev.watakumi.izuna')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerSessionIpc(() => mainWindow)

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/**
 * 終了時の後片付け。
 *
 * 取り残すと claude が孤児プロセスとして残るので待つ。ただし
 * **待ちが終わらないせいで終了できなくなってはいけない**（一度やらかした）。
 * `stopAllSessions` は上限付きで必ず返り、さらにここでも保険をかける。
 */
let quitting = false

function shutdown(): void {
  if (quitting) return
  quitting = true
  // 何があっても落ちる。片付けが返らなくても待たない
  const hardStop = setTimeout(() => process.exit(0), 5000)
  hardStop.unref?.()
  void stopAllSessions().finally(() => {
    clearTimeout(hardStop)
    app.exit(0)
  })
}

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  shutdown()
})

// **Ctrl+C は before-quit を通らない。** `pnpm dev` を止められるように
// SIGINT / SIGTERM も自分で受ける。
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, shutdown)
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
