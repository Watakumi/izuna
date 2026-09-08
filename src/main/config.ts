import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULTS, parseConfig, type IzunaConfig, type MergeResult } from '../shared/config'

/**
 * `~/.izuna/config.json` の読み書き。
 *
 * 判定と既定は `shared/config.ts`（純粋関数）が持つ。ここは読むだけ。
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
    claudePath: config.claudePath ? expandHome(config.claudePath) : null,
    ignored
  }
}
