import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolved } from '../config'

const exec = promisify(execFile)

/**
 * `claude` の実体を探す。
 *
 * Finder から起動した Electron は login shell の PATH を継承しないので、
 * `process.env.PATH` を信用すると mise / nvm / ~/.local/bin 配下を丸ごと見失う。
 * ログインシェルに一度だけ聞き、失敗したら既知の場所を順に当たる。
 */
export async function locateClaude(): Promise<string> {
  // 設定で明示されていればそれを使う（PATH に無い場所に置いている人のため）
  const { claudePath } = await resolved()
  if (claudePath && (await isExecutable(claudePath))) return claudePath

  const shell = process.env.SHELL ?? '/bin/zsh'
  try {
    const { stdout } = await exec(shell, ['-ilc', 'command -v claude'], { timeout: 5000 })
    const path = stdout.trim().split('\n').pop()?.trim()
    if (path && (await isExecutable(path))) return path
  } catch {
    // ログインシェルが対話起動に失敗する構成もある。フォールバックに落とす。
  }

  const candidates = [
    join(homedir(), '.local/bin/claude'),
    join(homedir(), '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ]
  for (const c of candidates) {
    if (await isExecutable(c)) return c
  }

  throw new Error(
    'claude が見つかりません。`claude` を PATH に通すか、設定で実行ファイルのパスを指定してください。'
  )
}

let cachedEnv: Promise<NodeJS.ProcessEnv> | null = null

/**
 * ログインシェルの環境変数一式を取り出す。
 * claude 自身が git や node を呼ぶので、PATH だけ足しても足りない。
 *
 * **一度取ったら覚える。** `-ilc` は `.zshrc` を毎回評価するので、
 * git を 1 回呼ぶたびにシェルを起こしていた（8 か所から、0.13 秒ずつ）。
 * rc を書き換えたあとは `refreshLoginShellEnv()` で取り直す（セッションの起動時）。
 */
export function loginShellEnv(): Promise<NodeJS.ProcessEnv> {
  cachedEnv ??= readLoginShellEnv()
  return cachedEnv
}

/** 取り直す。人が rc を直したあとに新しいセッションを起こすときに呼ぶ */
export function refreshLoginShellEnv(): Promise<NodeJS.ProcessEnv> {
  cachedEnv = readLoginShellEnv()
  return cachedEnv
}

async function readLoginShellEnv(): Promise<NodeJS.ProcessEnv> {
  const shell = process.env.SHELL ?? '/bin/zsh'
  try {
    // 区切りに NUL を使い、値に改行が含まれても壊れないようにする
    const { stdout } = await exec(shell, ['-ilc', 'env -0'], {
      timeout: 5000,
      maxBuffer: 1024 * 1024
    })
    const env: NodeJS.ProcessEnv = {}
    for (const entry of stdout.split('\0')) {
      const eq = entry.indexOf('=')
      if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1)
    }
    return Object.keys(env).length > 0 ? env : { ...process.env }
  } catch {
    return { ...process.env }
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
