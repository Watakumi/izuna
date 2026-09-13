import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULTS, parseConfig, type IzunaConfig, type MergeResult } from '../shared/config'

/**
 * `~/.izuna/config.json` の読み書き。
 *
 * 判定と既定は `shared/config.ts`（純粋関数）が持つ。ここは読み書きだけ。
 *
 * **無くても動く。** 設定は「他の環境に合わせるための逃げ道」であって、
 * 用意しないと使えないものではない。
 */

export const CONFIG_PATH = join(homedir(), '.izuna', 'config.json')

/** `~/x` を絶対パスに直す。設定に書くときは `~` のままでよい */
export function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

let cached: MergeResult | null = null

export async function loadConfig(): Promise<MergeResult> {
  if (cached) return cached
  try {
    cached = parseConfig(await readFile(CONFIG_PATH, 'utf8'))
  } catch {
    // 無いのが普通。既定で動く
    cached = { config: { ...DEFAULTS }, ignored: [] }
  }
  return cached
}

/** 探索先などは `~` を展開して使う */
export async function resolved(): Promise<IzunaConfig & { ignored: string[] }> {
  const { config, ignored } = await loadConfig()
  return {
    ...config,
    forgejoWorkPaths: config.forgejoWorkPaths.map(expandHome),
    repoRoots: config.repoRoots.map(expandHome),
    trustedRepos: config.trustedRepos.map(expandHome),
    claudePath: config.claudePath ? expandHome(config.claudePath) : null,
    ignored
  }
}

/**
 * 設定の 1 項目を書く（§37 でテーマを選ぶために足した）。
 *
 * **人が書いたものを消さない。** 既定を全部書き出すのではなく、いまのファイルの
 * 中身に鍵 1 つを重ねて書き戻す —— 既定を materialize すると、あとで Izuna の既定が
 * 変わっても古い値が残り、なぜ変わらないのか誰にも分からなくなる。
 *
 * 読めないファイルは**上書きしない**。人が手で書いた設定が壊れているとき、
 * 黙って捨てるのが一番害が大きい。
 */
export async function saveConfigValue<K extends keyof IzunaConfig>(
  key: K,
  value: IzunaConfig[K]
): Promise<void> {
  let current: Record<string, unknown> = {}
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as unknown
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('設定が読めません。手で直してください')
    current = raw as Record<string, unknown>
  } catch (e) {
    // 「無い」は普通。「壊れている」は上書きしない
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  current[key as string] = value
  await mkdir(dirname(CONFIG_PATH), { recursive: true })
  await writeFile(CONFIG_PATH, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
  cached = null
}
