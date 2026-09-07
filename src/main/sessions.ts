import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { summarize, type SessionSummary } from '../shared/sessions'

/**
 * `~/.claude/projects/` の走査（CLAUDE.md §18）。
 *
 * **保存層は自作しない。** ここがやるのはファイルを見つけて
 * 頭と尻尾を読むことだけで、解釈は `shared/sessions.ts` がやる。
 */

/** `CLAUDE_CONFIG_DIR` を尊重する。決め打ちにすると他人の環境で空になる */
export function claudeProjectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR?.trim()
  return join(base && base.length > 0 ? base : join(homedir(), '.claude'), 'projects')
}

/** 頭と尻尾に読む量。19MB のファイルでも一定時間で終わらせる */
const EDGE = 64 * 1024

/**
 * 千切れた行を落とす。境界で切るので**両端は必ず不完全**になりうる。
 * `head` は最後、`tail` は最初を捨てる。
 */
const linesOf = (buf: string, drop: 'first' | 'last'): string[] => {
  const all = buf.split('\n')
  return drop === 'first' ? all.slice(1) : all.slice(0, -1)
}

async function readEdges(path: string, bytes: number): Promise<{ head: string[]; tail: string[] }> {
  const fh = await open(path, 'r')
  try {
    if (bytes <= EDGE * 2) {
      const whole = (await fh.readFile()).toString('utf8')
      const all = whole.split('\n')
      return { head: all, tail: all }
    }
    const h = Buffer.alloc(EDGE)
    const t = Buffer.alloc(EDGE)
    await fh.read(h, 0, EDGE, 0)
    await fh.read(t, 0, EDGE, bytes - EDGE)
    return { head: linesOf(h.toString('utf8'), 'last'), tail: linesOf(t.toString('utf8'), 'first') }
  } finally {
    await fh.close()
  }
}

/** 一度に見る上限。**古いものまで舐めない** —— 一覧が開かなくなる */
const MAX = 300

/**
 * 全プロジェクトのセッションを新しい順に返す。
 *
 * **どのリポジトリのものかは中の `cwd` で決める**（ディレクトリ名は
 * 元に戻せない。`shared/sessions.ts` の `projectDirName` の註を見よ）。
 * 絞り込みは呼ぶ側の仕事。
 */
export async function scanSessions(): Promise<SessionSummary[]> {
  const root = claudeProjectsDir()
  let dirs: string[]
  try {
    dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return [] // まだ一度も使っていない環境。空は異常ではない
  }

  const found: { path: string; id: string; updatedAt: number; bytes: number }[] = []
  for (const d of dirs) {
    let names: string[]
    try {
      names = await readdir(join(root, d))
    } catch {
      continue
    }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue
      const path = join(root, d, n)
      try {
        const st = await stat(path)
        if (!st.isFile() || st.size === 0) continue
        found.push({ path, id: n.slice(0, -'.jsonl'.length), updatedAt: st.mtimeMs, bytes: st.size })
      } catch {
        continue
      }
    }
  }

  // 読む前に絞る。**新しい順に MAX 件だけ**開く
  found.sort((a, b) => b.updatedAt - a.updatedAt)
  const targets = found.slice(0, MAX)

  const out = await Promise.all(
    targets.map(async (f) => {
      try {
        const { head, tail } = await readEdges(f.path, f.bytes)
        return summarize(head, tail, { id: f.id, updatedAt: f.updatedAt, bytes: f.bytes })
      } catch {
        return null // 読めない 1 件で一覧を落とさない
      }
    })
  )
  return out.filter((s): s is SessionSummary => s !== null)
}

/** 復元用に全文の行を返す。**一覧では呼ばない**（19MB を読む） */
export async function readSessionLines(id: string): Promise<string[]> {
  const root = claudeProjectsDir()
  const dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory())
  for (const d of dirs) {
    const path = join(root, d.name, `${id}.jsonl`)
    try {
      const fh = await open(path, 'r')
      try {
        return (await fh.readFile()).toString('utf8').split('\n')
      } finally {
        await fh.close()
      }
    } catch {
      continue
    }
  }
  throw new Error(`セッション ${id} の記録が見つかりません`)
}
