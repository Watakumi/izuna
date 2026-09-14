import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { formatAction, parseActions, type Action, type ActionKind } from '../shared/actions'

/**
 * 外に出た操作の記録（§38）。**追記だけ。**
 *
 * 判定と形は `shared/actions.ts`（純粋関数）が持つ。ここは読み書きだけ。
 * DB は持たない —— 1 件 1 行のテキストで足り、人が `tail` で読める。
 */

export const ACTIONS_PATH = join(homedir(), '.izuna', 'actions.log')

/**
 * 1 行足す。**書けなくても、元の操作は成功のままにする。**
 *
 * push は通ったのに「push が失敗した」と見えるのが一番悪い。書けなかったことは
 * main のログに出す —— 黙って飲まない（規則 6 の趣旨）。
 */
export async function appendAction(a: Action): Promise<void> {
  try {
    await mkdir(dirname(ACTIONS_PATH), { recursive: true })
    await appendFile(ACTIONS_PATH, `${formatAction(a)}\n`, 'utf8')
  } catch (e) {
    console.error('[izuna] 操作の記録を書けませんでした:', (e as Error).message)
  }
}

/**
 * 操作を 1 つ包む。通っても失敗しても記録し、**失敗はそのまま投げ直す**。
 *
 * 記録のために振る舞いを変えない —— 呼び手から見て、包む前と同じものが返る。
 */
export async function noting<T>(
  kind: ActionKind,
  target: string,
  run: () => Promise<T>,
  note: (value: T) => string = () => ''
): Promise<T> {
  const at = new Date().toISOString()
  try {
    const value = await run()
    await appendAction({ at, kind, target, ok: true, note: note(value) })
    return value
  } catch (e) {
    await appendAction({ at, kind, target, ok: false, note: (e as Error).message })
    throw e
  }
}

/** 新しいものから `limit` 件。無ければ空（**まだ何もしていないだけ**） */
export async function readActions(limit = 20): Promise<Action[]> {
  try {
    return parseActions(await readFile(ACTIONS_PATH, 'utf8'), limit)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
}
