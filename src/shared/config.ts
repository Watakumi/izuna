/**
 * Izuna の設定（`~/.izuna/config.json`）。
 *
 * 純粋関数。**壊れた設定でアプリを起動不能にしない** ——
 * 読めない値は既定に落とし、何を落としたかを言う。
 *
 * 既定は作者の環境（macOS + Homebrew）に寄せてあるが、
 * ここを上書きすれば他の環境でも動く。
 */

export interface IzunaConfig {
  /** Forgejo の作業ディレクトリ候補。Docker で建てているなら空にして forgejoUrl を使う */
  forgejoWorkPaths: string[]
  /** app.ini が読めないときに使う ROOT_URL */
  forgejoUrl: string | null
  /** sandbox の remote を作るときの名前 */
  sandboxRemote: string
  /** リポジトリの探索先 */
  repoRoots: string[]
  /** 探索の深さ */
  repoDepth: number
  /** claude の実行ファイル。null なら PATH から探す */
  claudePath: string | null
  /** 読み込む設定の出どころ。既定はプラグイン hook を避ける（CLAUDE.md §13） */
  settingSources: Array<'user' | 'project' | 'local'>
  /**
   * hook があっても聞かずに開いてよい場所。前方一致。
   * 既定は空 —— **信頼は書いた人だけが足す**（§26）
   */
  trustedRepos: string[]
}

/** `~` は main 側で homedir に展開する。ここでは文字列のまま扱う */
export const DEFAULTS: IzunaConfig = {
  forgejoWorkPaths: ['/opt/homebrew/var/forgejo', '/usr/local/var/forgejo', '~/.forgejo'],
  forgejoUrl: null,
  sandboxRemote: 'forgejo',
  repoRoots: ['~/work', '~/src', '~/dev', '~/Projects', '~/projects', '~/ghq', '~/repos'],
  repoDepth: 3,
  claudePath: null,
  settingSources: ['project', 'local'],
  trustedRepos: []
}

export interface MergeResult {
  config: IzunaConfig
  /** 落とした項目。黙って既定に倒すと、直したのに効かない理由が分からなくなる */
  ignored: string[]
}

const SOURCES = ['user', 'project', 'local'] as const

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim() !== '')
    ? (v as string[]).map((s) => s.trim())
    : null

/**
 * 読んだものを既定に重ねる。**型が合わないものは落として既定を使う。**
 * 例外にしない —— 設定 1 行の誤りでアプリが起動しないのは割に合わない。
 */
export function mergeConfig(raw: unknown): MergeResult {
  const ignored: string[] = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) ignored.push('（設定全体がオブジェクトではありません）')
    return { config: { ...DEFAULTS }, ignored }
  }

  const input = raw as Record<string, unknown>
  const config: IzunaConfig = { ...DEFAULTS }

  const take = <K extends keyof IzunaConfig>(
    key: K,
    read: (v: unknown) => IzunaConfig[K] | null
  ): void => {
    if (!(key in input)) return
    const value = read(input[key])
    if (value === null) ignored.push(String(key))
    else config[key] = value
  }

  take('forgejoWorkPaths', strings)
  take('repoRoots', strings)
  take('trustedRepos', (v) => (Array.isArray(v) && v.length === 0 ? [] : strings(v)))
  take('forgejoUrl', (v) =>
    v === null ? null : typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  )
  take('claudePath', (v) =>
    v === null ? null : typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  )
  take('sandboxRemote', (v) => (typeof v === 'string' && /^[\w.-]+$/.test(v) ? v : null))
  take('repoDepth', (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 6 ? v : null
  )
  take('settingSources', (v) =>
    Array.isArray(v) && v.every((x) => (SOURCES as readonly string[]).includes(x as string))
      ? (v as IzunaConfig['settingSources'])
      : null
  )

  // null を許す項目は「明示的に消した」と「型が違う」が同じ形になる。
  // 前者は落としたことにしない
  for (const key of ['forgejoUrl', 'claudePath'] as const) {
    if (input[key] === null) {
      const at = ignored.indexOf(key)
      if (at !== -1) ignored.splice(at, 1)
    }
  }

  return { config, ignored }
}

/** JSON として読む。壊れていても落ちない */
export function parseConfig(text: string): MergeResult {
  try {
    return mergeConfig(JSON.parse(text))
  } catch {
    return { config: { ...DEFAULTS }, ignored: ['（JSON として読めませんでした）'] }
  }
}
