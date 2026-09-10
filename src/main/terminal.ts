import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { BrowserWindow } from 'electron'
import { loginShellEnv } from './claude/locate'

/**
 * worktree のシェル（段6）。
 *
 * **libghostty はここでは動かない。** VT の解釈と描画は renderer 側の
 * `ghostty-web`（libghostty-vt の公式 WASM ビルド）がやる。
 * main は PTY を持つだけで、バイト列をそのまま流す。
 *
 * 解釈しない。**加工もしない** —— ANSI を落とすのは会話ビュー側の話で、
 * ここは端末なので生のまま渡す（CLAUDE.md の `stripAnsi` の註）。
 */

type Pty = import('node-pty').IPty

export interface TerminalOptions {
  cwd: string
  cols: number
  rows: number
  /** 省略するとログインシェル */
  shell?: string
}

const terminals = new Map<string, Pty>()

/** node-pty はネイティブモジュール。読み込みに失敗しても、アプリは落とさない */
async function loadPty(): Promise<typeof import('node-pty')> {
  try {
    return await import('node-pty')
  } catch (err) {
    throw new Error(
      'PTY を読み込めませんでした。`pnpm install` で Electron 向けの再ビルドが' +
        `済んでいるか確認してください: ${String(err)}`
    )
  }
}

export async function openTerminal(
  getWindow: () => BrowserWindow | null,
  channel: string,
  options: TerminalOptions
): Promise<string> {
  const { spawn } = await loadPty()
  const env = await loginShellEnv()
  const shell = options.shell ?? env.SHELL ?? '/bin/zsh'
  const id = randomUUID()

  const pty = spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols: Math.max(options.cols, 20),
    rows: Math.max(options.rows, 5),
    cwd: options.cwd || homedir(),
    env: env as Record<string, string>
  })

  pty.onData((data) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, { id, kind: 'data', data })
  })
  pty.onExit(({ exitCode }) => {
    terminals.delete(id)
    const win = getWindow()
    if (win && !win.isDestroyed())
      win.webContents.send(channel, { id, kind: 'exit', code: exitCode })
  })

  terminals.set(id, pty)
  return id
}

export function writeTerminal(id: string, data: string): void {
  terminals.get(id)?.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  // 0 を渡すと node-pty が落ちる。畳まれたペインから来ることがある
  terminals.get(id)?.resize(Math.max(cols, 1), Math.max(rows, 1))
}

export function closeTerminal(id: string): void {
  const pty = terminals.get(id)
  if (!pty) return
  terminals.delete(id)
  try {
    pty.kill()
  } catch {
    // 既に死んでいることがある。終了処理で例外を上げない
  }
}

/** アプリ終了時。取り残すとシェルが孤児になる */
export function closeAllTerminals(): void {
  for (const id of [...terminals.keys()]) closeTerminal(id)
}
