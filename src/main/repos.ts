import { readdir, access } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import { resolved } from './config'
import { dialog, type BrowserWindow } from 'electron'

/**
 * リポジトリの探索（絶対パスの直打ちをやめるため）。
 *
 * **決め打ちで深く潜らない。** ホーム全体を舐めると遅いうえ、
 * node_modules の中の .git まで拾って役に立たない。
 * 「よくある置き場を、浅く」に留める。
 */

/** 探索先は設定から引く（`~/.izuna/config.json` の `repoRoots`） */

export interface FoundRepo {
  path: string
  name: string
  /** 一覧での見出し。`work/personal` のような相対の親 */
  group: string
}

const exists = async (p: string): Promise<boolean> => {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  'target',
  'vendor',
  'Library'
])

/**
 * `.git` を持つディレクトリを探す。見つけたらそこで降りるのをやめる
 * （リポジトリの中の submodule や worktree まで並べても混乱する）。
 */
async function walk(dir: string, depth: number, out: FoundRepo[], base: string): Promise<void> {
  if (depth < 0 || out.length >= 300) return

  if (await exists(join(dir, '.git'))) {
    const rel = dir.startsWith(base) ? dir.slice(base.length).replace(/^\//, '') : dir
    const parts = rel.split('/')
    out.push({
      path: dir,
      name: basename(dir),
      group: parts.length > 1 ? `${basename(base)}/${parts.slice(0, -1).join('/')}` : basename(base)
    })
    return
  }

  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // 読めないところは飛ばす。権限エラーで探索ごと落とさない
  }

  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
      .map((e) => walk(join(dir, e.name), depth - 1, out, base))
  )
}

/** 既定の置き場を浅く探す。深さ 3 でも `~/work/<分類>/<repo>` は拾える */
export async function findRepos(roots?: string[], depth?: number): Promise<FoundRepo[]> {
  const cfg = await resolved()
  roots ??= cfg.repoRoots
  depth ??= cfg.repoDepth
  const out: FoundRepo[] = []
  for (const root of roots) {
    if (await exists(root)) await walk(root, depth, out, root)
  }
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
}

/** ネイティブのフォルダ選択。探索に出てこない場所のため */
export async function pickDirectory(window: BrowserWindow | null): Promise<string | null> {
  const result = window
    ? await dialog.showOpenDialog(window, {
        properties: ['openDirectory'],
        message: 'リポジトリを選ぶ'
      })
    : await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return result.canceled ? null : (result.filePaths[0] ?? null)
}
