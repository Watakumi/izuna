import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  colorsOf,
  mergeColors,
  monoFrom,
  parseGhosttyConfig,
  readingFrom,
  skinFrom,
  terminalTheme,
  type GhosttyConfig,
  type GhosttyColors,
  type Reading,
  type Skin,
  type ThemeChoice
} from '../shared/ghostty'

/**
 * Ghostty の設定を探して読む（解釈は `shared/ghostty.ts`）。
 *
 * **無くても動く。** 見つからなければ null を返し、Izuna は既定の色で出る。
 * ここで失敗してアプリが起動しないのは本末転倒である。
 */

/** 設定ファイルの置き場。実測で `~/.config/ghostty/config` が使われていた */
function configPaths(): string[] {
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  const home = homedir()
  return [
    ...(xdg ? [join(xdg, 'ghostty', 'config')] : []),
    join(home, '.config', 'ghostty', 'config'),
    join(home, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config')
  ]
}

/**
 * テーマ名を実ファイルに解く。
 *
 * **利用者の置き場を先に見る。** 実測で `theme = notion` は
 * アプリ同梱ではなく `~/.config/ghostty/themes/notion`（自作）だった。
 * 同梱を先に見ると、同名の自作テーマが無視される。
 */
function themePaths(name: string): string[] {
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  const home = homedir()
  return [
    ...(xdg ? [join(xdg, 'ghostty', 'themes', name)] : []),
    join(home, '.config', 'ghostty', 'themes', name),
    join('/Applications/Ghostty.app/Contents/Resources/ghostty/themes', name)
  ]
}

async function readFirst(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    try {
      return await readFile(p, 'utf8')
    } catch {
      continue
    }
  }
  return null
}

export interface GhosttySkin {
  skin: Skin
  /** どこから来たか。設定画面に出して、効いていることを見せる */
  source: { config: string | null; theme: string | null }
  /** 等幅の候補（先頭が利用者の指定） */
  mono: string[]
  /** 読む面の組み */
  reading: Reading
  /** ターミナルに渡す配色（xterm.js の ITheme と同じ形） */
  terminal: Record<string, string>
  /** ターミナルの字の大きさ */
  terminalFontSize: number | null
}

export async function loadGhosttySkin(): Promise<GhosttySkin | null> {
  const text = await readFirst(configPaths())
  if (text === null) return null

  const config: GhosttyConfig = parseGhosttyConfig(text)

  // テーマを先に敷き、設定ファイル本体で上書きする（Ghostty と同じ順）
  let colors = config.colors
  let themeName: string | null = null
  if (config.theme) {
    const themeText = await readFirst(themePaths(config.theme))
    if (themeText !== null) {
      themeName = config.theme
      colors = mergeColors(parseGhosttyConfig(themeText).colors, config.colors)
    }
  }

  const skin = skinFrom(colors)
  if (!skin) return null
  return {
    skin,
    source: { config: config.theme, theme: themeName },
    mono: monoFrom(config),
    reading: readingFrom(config),
    terminal: terminalTheme(colors),
    terminalFontSize: config.fontSize
  }
}

/**
 * 実機にある Ghostty のテーマの名前（§37）。**利用者の置き場を先に、同梱を後に。**
 * 同名があれば自作が勝つ（`themePaths` と同じ順）。読めなければ空を返す ——
 * テーマが見つからないのは異常ではない（Ghostty を入れていないだけ）。
 */
export async function listThemes(): Promise<string[]> {
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  const home = homedir()
  const dirs = [
    ...(xdg ? [join(xdg, 'ghostty', 'themes')] : []),
    join(home, '.config', 'ghostty', 'themes'),
    '/Applications/Ghostty.app/Contents/Resources/ghostty/themes'
  ]
  const seen = new Set<string>()
  for (const dir of dirs) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const n of names) if (!n.startsWith('.')) seen.add(n)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/**
 * 選ばれた配色で組む（§37）。
 *
 * **書体と読む面は、いつも利用者の Ghostty から借りる。** 配色だけを差し替える ——
 * テーマを選んだからといって、書体の好み（`font-thicken` や UD 書体。§21）まで
 * 捨てる理由が無い。Ghostty が無ければ既定で出る。
 */
export async function loadSkin(choice: ThemeChoice): Promise<GhosttySkin | null> {
  if (choice.kind === 'ghostty') return loadGhosttySkin()
  if (choice.kind === 'builtin') return null

  const text = await readFirst(configPaths())
  const config: GhosttyConfig = text === null ? parseGhosttyConfig('') : parseGhosttyConfig(text)

  let colors: GhosttyColors | null = null
  let themeName: string | null = null
  if (choice.kind === 'named') {
    const themeText = await readFirst(themePaths(choice.name))
    if (themeText !== null) {
      colors = parseGhosttyConfig(themeText).colors
      themeName = choice.name
    }
  } else {
    colors = colorsOf(choice.colors)
  }
  // 読めなければ既定に倒す。**半端に当てない**（§21）
  if (!colors) return null

  const skin = skinFrom(colors)
  if (!skin) return null
  return {
    skin,
    source: { config: config.theme, theme: themeName },
    mono: monoFrom(config),
    reading: readingFrom(config),
    terminal: terminalTheme(colors),
    terminalFontSize: config.fontSize
  }
}
