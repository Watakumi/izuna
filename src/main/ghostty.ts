import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  mergeColors, parseGhosttyConfig, skinFrom,
  type GhosttyConfig, type Skin
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
  fontFamily: string[]
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
  return { skin, source: { config: config.theme, theme: themeName }, fontFamily: config.fontFamily }
}
