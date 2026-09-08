/**
 * あとで自動的に再開する予約。
 *
 * ここはファイルもタイマーも知らない（§4 の原則）。
 * 「いつ起こすか」「過ぎたものをどうするか」を決めるだけ。
 */

export type WakeupState = 'pending' | 'overdue' | 'fired'

export interface Wakeup {
  id: string
  /** どのセッションを起こすか（claude 側の id） */
  sessionId: string
  cwd: string
  /** 起きたときに送る依頼 */
  prompt: string
  /** epoch ms */
  fireAt: number
  state: WakeupState
  createdAt: number
}

/**
 * アプリを閉じているあいだに時刻が過ぎたものは、**自動で発火させない**。
 *
 * 夜中に予約したものが、翌朝アプリを開いた瞬間に一斉に走り出す —— という
 * 事故を避ける。過ぎたことは見せて、人に決めさせる。
 * （Nimbalyst も同じ判断をしていた。2026-09-08 に確認）
 */
export function reconcile(wakeups: Wakeup[], now: number): Wakeup[] {
  return wakeups.map((w) =>
    w.state === 'pending' && w.fireAt <= now ? { ...w, state: 'overdue' as const } : w
  )
}

/** 次に起こすもの。**同着は先に作ったほうから**（順が呼ぶたびに変わらない） */
export function next(wakeups: Wakeup[], now: number): Wakeup | null {
  const ready = wakeups
    .filter((w) => w.state === 'pending' && w.fireAt > now)
    .sort((a, b) => a.fireAt - b.fireAt || a.createdAt - b.createdAt)
  return ready[0] ?? null
}

/** いま起こすべきもの（時刻がちょうど来たもの） */
export function due(wakeups: Wakeup[], now: number): Wakeup[] {
  return wakeups.filter((w) => w.state === 'pending' && w.fireAt <= now)
}

/** 壊れた記録で起動不能にしない。読めないものは黙って捨てる */
export function parseWakeups(text: string): Wakeup[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw.filter(isWakeup)
}

const isWakeup = (v: unknown): v is Wakeup => {
  if (typeof v !== 'object' || v === null) return false
  const w = v as Wakeup
  return typeof w.id === 'string' && typeof w.sessionId === 'string' &&
    typeof w.prompt === 'string' && typeof w.fireAt === 'number' &&
    typeof w.cwd === 'string' && typeof w.createdAt === 'number' &&
    ['pending', 'overdue', 'fired'].includes(w.state)
}

/** 人に見せる待ち時間 */
export function until(fireAt: number, now: number): string {
  const m = Math.round((fireAt - now) / 60_000)
  if (m <= 0) return 'まもなく'
  if (m < 60) return `${m}分後`
  if (m < 60 * 24) return `${Math.round(m / 60)}時間後`
  return `${Math.round(m / 60 / 24)}日後`
}
