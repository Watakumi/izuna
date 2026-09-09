import { run } from '../exec'
import { locateClaude, loginShellEnv } from './locate'
import { withoutBillingKeys } from '../../shared/billing'
import type { ClaudeFacts } from '../../shared/prereq'

/**
 * Claude Code の状態を集める（判定は `shared/prereq.ts`）。
 *
 * `claude auth status --json` は email や orgId も返すが、**画面に出すのは
 * ログイン済みか・方法・プランだけ**。人の識別子をアプリの状態に持たない。
 * 環境の鍵は落として聞く —— 拾うと「API キーでログイン済み」に見える（§14）。
 */
/** 鍵を落とした環境で呼ぶ。`run()` の `replaceEnv` で、ログインシェルの環境を重ねない */
const ask = (path: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> =>
  run(path, args, { env, replaceEnv: true, timeoutMs: 8000 })

export async function claudeStatus(): Promise<ClaudeFacts> {
  let path: string
  try {
    path = await locateClaude()
  } catch {
    return { path: null, version: null, loggedIn: null, authMethod: null, subscription: null }
  }
  const { env } = withoutBillingKeys(await loginShellEnv())
  const version = await ask(path, ['--version'], env)
    .then((v) => /(\d+\.\d+\.\d+)/.exec(v)?.[1] ?? null)
    .catch(() => null)
  try {
    const out = await ask(path, ['auth', 'status', '--json'], env)
    const s = JSON.parse(out) as {
      loggedIn?: boolean
      authMethod?: string
      subscriptionType?: string
    }
    return {
      path,
      version,
      loggedIn: typeof s.loggedIn === 'boolean' ? s.loggedIn : null,
      authMethod: s.authMethod ?? null,
      subscription: s.subscriptionType ?? null
    }
  } catch {
    return { path, version, loggedIn: null, authMethod: null, subscription: null }
  }
}
