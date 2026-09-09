import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loginShellEnv } from './claude/locate'

const exec = promisify(execFile)

/**
 * 外の道具（git / gh / forgejo / brew）を呼ぶ唯一の包み。
 *
 * 同じ形の包みが 5 つのファイルにあった（§27）。どれも「ログインシェルの
 * 環境で `execFile` し、stderr を例外の文にする」で、違いは上限だけだった。
 *
 * **シェルは通さない。** 引数は配列で渡す。
 * **stderr を捨てない。** 道具の言い分をそのまま人に見せる。握りつぶすと原因が分からなくなる。
 */
export interface RunOptions {
  cwd?: string
  /** ログインシェルの環境に重ねるもの（資格情報など） */
  env?: NodeJS.ProcessEnv
  /**
   * `env` を重ねずに**そのまま**使う。ログインシェルの環境から鍵を落として呼ぶとき
   * （`claude auth status` を API キーで「ログイン済み」に見せない。§14）
   */
  replaceEnv?: boolean
  timeoutMs?: number
  maxBuffer?: number
}

export async function run(cmd: string, args: string[], options: RunOptions = {}): Promise<string> {
  const env = options.replaceEnv ? (options.env ?? {}) : { ...(await loginShellEnv()), ...(options.env ?? {}) }
  try {
    const { stdout } = await exec(cmd, args, {
      cwd: options.cwd,
      env,
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024
    })
    return stdout
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    throw new Error((e.stderr || e.message || String(err)).trim())
  }
}
