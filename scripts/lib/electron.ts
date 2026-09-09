import { chromium, type Browser, type Page } from 'playwright'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * 本物の Electron を起動して CDP で繋ぐ（§30）。`e2e.ts` と `walk.ts` が使う。
 *
 * **Playwright の `_electron.launch` は使わない。** `--use-mock-keychain` を付けるので
 * `safeStorage` が本物と違う鍵で動き、保管したトークンが読めない（2026-09-09 に踏んだ）。
 * `electron-vite dev` と同じく素の `electron .` を起動し、CDP で renderer に繋ぐ。
 */
export const ROOT = join(__dirname, '..', '..')

export interface Running {
  ps: ChildProcess
  browser: Browser
  page: Page
  close: () => Promise<void>
}

type Api = Record<string, (...args: unknown[]) => Promise<unknown>>

/** renderer の `window.izuna` を呼ぶ。preload が出している面そのもの */
export const call = <T>(page: Page, name: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([n, a]) => (window as unknown as { izuna: Api }).izuna[n](...a) as Promise<T>, [
    name,
    args
  ] as const)

/** `binary` を渡せば組んだ配布物（`dist/mac-arm64/Izuna.app/...`）を起こせる。既定は `electron .` */
export async function launch(port: number, binary?: string): Promise<Running> {
  if (!existsSync(join(ROOT, 'out', 'main', 'index.js'))) {
    throw new Error('out/ が無い。先に pnpm build')
  }
  // **既に誰かが同じ port で待っていたら起動しない。** 前の走行の Electron が残っていると、
  // 新しく起こしたつもりで古いほうに繋がり、動いているセッションを相手に走る（2026-09-09 に踏んだ）
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`)
    if (res.ok)
      throw new Error(
        `port ${port} は既に開いている。前の Electron が残っていないか（lsof -i :${port}）`
      )
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('port ')) throw e
    // 開いていない。それでよい
  }
  const require = createRequire(__filename)
  const electronPath = binary ?? (require('electron') as string)
  const ps = spawn(electronPath, [...(binary ? [] : ['.']), `--remote-debugging-port=${port}`], {
    cwd: ROOT,
    stdio: 'ignore'
  })
  let opened = false
  for (let i = 0; i < 40 && !opened; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      opened = res.ok
    } catch {
      // まだ開いていない
    }
    if (!opened) await new Promise((r) => setTimeout(r, 250))
  }
  if (!opened) {
    ps.kill()
    throw new Error('Electron の CDP が 10 秒で開かなかった')
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = browser.contexts()[0].pages()[0]
  await page.waitForLoadState('domcontentloaded')
  return {
    ps,
    browser,
    page,
    close: async () => {
      await browser.close().catch(() => undefined)
      ps.kill()
    }
  }
}
