import { randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { due, next, parseWakeups, reconcile, split, type Wakeup } from '../shared/wakeup'

/**
 * 起床の予約を持つ（判断は `shared/wakeup.ts`）。
 *
 * **DB は使わない。** 覚えるのは「いつ・どのセッションに・何を送るか」だけで、
 * 数も高々数十件である。JSON 1 枚で足りる（§18 と同じ理由）。
 */

export const WAKEUPS_PATH = join(homedir(), '.izuna', 'wakeups.json')

async function load(): Promise<Wakeup[]> {
  try {
    return parseWakeups(await readFile(WAKEUPS_PATH, 'utf8'))
  } catch {
    return []
  }
}

async function save(wakeups: Wakeup[]): Promise<void> {
  await mkdir(dirname(WAKEUPS_PATH), { recursive: true })
  const tmp = `${WAKEUPS_PATH}.tmp`
  await writeFile(tmp, JSON.stringify(wakeups, null, 2), 'utf8')
  await rename(tmp, WAKEUPS_PATH)
}

/**
 * 予約を持って、時が来たら起こす。
 *
 * **タイマーは 1 本だけ**張る。件数分の `setTimeout` を撒くと、
 * 消したはずのものが残っていて二重に起きる。
 */
export class Wakeups {
  #timer: NodeJS.Timeout | null = null
  #fire: (w: Wakeup) => void = () => {}
  /**
   * 起こしてよい id。**起動時に読んだものと、この画面から足したものだけ。**
   * 走っている最中にファイルへ直接書き足されたものは起こさない（§26）。
   * 起動時のものを信じるのは、一覧に出て人の目に触れるからである。
   */
  #known = new Set<string>()

  /** 起こすときに呼ばれる。呼ぶ側がセッションを再開する */
  onFire(handler: (w: Wakeup) => void): void {
    this.#fire = handler
  }

  /**
   * 起動時に 1 回。**過ぎているものは発火させず、`overdue` にして見せる。**
   * 閉じているあいだに溜まった分が、開いた瞬間に一斉に走り出すのを避ける。
   */
  async start(): Promise<Wakeup[]> {
    const reconciled = reconcile(await load(), Date.now())
    for (const w of reconciled) this.#known.add(w.id)
    await save(reconciled)
    this.#arm(reconciled)
    return reconciled
  }

  async list(): Promise<Wakeup[]> {
    return load()
  }

  async add(input: {
    sessionId: string
    cwd: string
    prompt: string
    fireAt: number
  }): Promise<Wakeup> {
    const w: Wakeup = { ...input, id: randomUUID(), state: 'pending', createdAt: Date.now() }
    this.#known.add(w.id)
    const all = [...(await load()), w]
    await save(all)
    this.#arm(all)
    return w
  }

  async remove(id: string): Promise<void> {
    const all = (await load()).filter((w) => w.id !== id)
    await save(all)
    this.#arm(all)
  }

  /** 過ぎてしまったものを、人が改めて起こす */
  async fireNow(id: string): Promise<Wakeup | null> {
    const all = await load()
    const w = all.find((x) => x.id === id)
    if (!w) return null
    await save(all.map((x) => (x.id === id ? { ...x, state: 'fired' as const } : x)))
    this.#fire(w)
    return w
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }

  #arm(wakeups: Wakeup[]): void {
    this.stop()
    const now = Date.now()
    const soonest = next(wakeups, now)
    /**
     * **既に期限が来ているものがあれば、次が無くても tick する。**
     * `add()` は保存してから張る。保存に時間がかかると（遅い CI で踏んだ。2026-09-09）、
     * 張る時点で期限が過ぎていて `next()` が null になり、タイマーを張らないまま
     * 誰も起こさなくなっていた。
     */
    if (!soonest && due(wakeups, now).length === 0) return
    // **上限を切る。** 何日も先の予約に長いタイマーを張ると、
    // その間に足された近いものを取り逃がす
    const wait = soonest ? Math.min(soonest.fireAt - now, 60_000) : 0
    this.#timer = setTimeout(
      () => {
        void this.#tick()
      },
      Math.max(wait, 250)
    )
  }

  async #tick(): Promise<void> {
    const all = await load()
    const now = Date.now()
    const { fire, reject } = split(due(all, now), this.#known)
    if (fire.length > 0 || reject.length > 0) {
      const state = (w: Wakeup): Wakeup['state'] =>
        fire.some((r) => r.id === w.id)
          ? 'fired'
          : reject.some((r) => r.id === w.id)
            ? 'rejected'
            : w.state
      await save(all.map((w) => ({ ...w, state: state(w) })))
      for (const w of fire) this.#fire(w)
    }
    this.#arm(await load())
  }
}
