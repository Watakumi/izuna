import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_CONSECUTIVE_FAILURES, PROGRESS_FILE, readProgress, runLoop, writeProgress } from '../src/main/loop'
import { EMPTY_PROGRESS, type Progress } from '../src/shared/loop'

/**
 * 自律ループの駆動部。
 *
 * **止まらないことと、止まりすぎることの両方を見る。** 無人で回るものなので、
 * どちらも人が気づかないまま損をする。
 */

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'izuna-loop-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const progressAt = (): Progress => JSON.parse(readFileSync(join(dir, PROGRESS_FILE), 'utf8')) as Progress

describe('進捗の読み書き', () => {
  it('無ければ既定', async () => {
    expect(await readProgress(dir)).toEqual(EMPTY_PROGRESS)
  })

  it('往復する', async () => {
    await writeProgress(dir, { ...EMPTY_PROGRESS, currentIteration: 2, phase: 'building' })
    expect(await readProgress(dir)).toMatchObject({ currentIteration: 2, phase: 'building' })
  })

  it('**書き換え中に落ちても壊さない**（一時ファイルに書いてから置き換える）', async () => {
    await writeProgress(dir, EMPTY_PROGRESS)
    expect(existsSync(join(dir, `${PROGRESS_FILE}.tmp`))).toBe(false)
  })

  it('壊れたファイルは既定に倒す（1 回の書き損じでループを殺さない）', async () => {
    writeFileSync(join(dir, PROGRESS_FILE), '{途中で切れて')
    expect(await readProgress(dir)).toEqual(EMPTY_PROGRESS)
  })

  it('引き継ぎが増え続けないよう、書くときに切る', async () => {
    await writeProgress(dir, {
      ...EMPTY_PROGRESS,
      learnings: Array.from({ length: 40 }, (_, i) => ({ iteration: i, summary: `${i}`, filesChanged: [] }))
    })
    expect(progressAt().learnings.length).toBeLessThanOrEqual(20)
  })
})

describe('回す', () => {
  it('宣言されるまで回り、宣言されたら止まる', async () => {
    let seen = 0
    const loop = runLoop({
      teamDir: dir,
      maxIterations: 10,
      runIteration: async (_prompt, iteration) => {
        seen = iteration
        await writeProgress(dir, {
          ...EMPTY_PROGRESS,
          currentIteration: iteration,
          completionSignal: iteration === 3
        })
      }
    })
    expect(await loop.done).toMatchObject({ reason: 'completed' })
    expect(seen).toBe(3)
  })

  it('上限で打ち切る（**止まらないほうが怖い**）', async () => {
    const loop = runLoop({
      teamDir: dir,
      maxIterations: 4,
      runIteration: async (_p, iteration) => {
        await writeProgress(dir, { ...EMPTY_PROGRESS, currentIteration: iteration })
      }
    })
    expect(await loop.done).toMatchObject({ reason: 'maxIterations' })
  })

  it('詰まったら止まり、理由を持ち帰る', async () => {
    const loop = runLoop({
      teamDir: dir,
      maxIterations: 10,
      runIteration: async () => {
        await writeProgress(dir, { ...EMPTY_PROGRESS, currentIteration: 1, status: 'blocked', blockers: ['鍵が無い'] })
      }
    })
    expect(await loop.done).toMatchObject({ reason: 'blocked', detail: '鍵が無い' })
  })

  it('人が止められる', async () => {
    const loop = runLoop({
      teamDir: dir,
      maxIterations: 100,
      runIteration: async (_p, iteration) => {
        await writeProgress(dir, { ...EMPTY_PROGRESS, currentIteration: iteration })
        if (iteration === 2) loop.stop()
      }
    })
    expect(await loop.done).toMatchObject({ reason: 'stopped' })
  })

  it('**進捗を申告せずに終わる反復があっても、同じ本文で回り続けない**', async () => {
    let runs = 0
    const loop = runLoop({
      teamDir: dir,
      maxIterations: 3,
      // ツールを呼ばない（＝ progress.json を書かない）反復
      runIteration: async () => { runs++ }
    })
    expect(await loop.done).toMatchObject({ reason: 'maxIterations' })
    expect(runs).toBe(3)
  })

  it('一度の失敗では諦めない', async () => {
    let runs = 0
    const loop = runLoop({
      teamDir: dir,
      maxIterations: 10,
      runIteration: async (_p, iteration) => {
        runs++
        if (runs === 1) throw new Error('一時的な失敗')
        await writeProgress(dir, { ...EMPTY_PROGRESS, currentIteration: iteration, completionSignal: true })
      }
    })
    expect(await loop.done).toMatchObject({ reason: 'completed' })
    expect(runs).toBeGreaterThan(1)
  })

  it(`**続けて ${MAX_CONSECUTIVE_FAILURES} 回失敗したら人を呼ぶ**（同じ場所で回り続けない）`, async () => {
    const loop = runLoop({
      teamDir: dir,
      maxIterations: 100,
      runIteration: async () => { throw new Error('いつも失敗する') }
    })
    const stop = await loop.done
    expect(stop.reason).toBe('failed')
    expect(stop.detail).toContain('いつも失敗する')
  }, 20_000)

  it('引き継ぎが本文に入る（前の反復の記憶はこれだけ）', async () => {
    const prompts: string[] = []
    await writeProgress(dir, {
      ...EMPTY_PROGRESS,
      learnings: [{ iteration: 1, summary: '検査が落ちる原因は型', filesChanged: ['a.ts'] }]
    })
    const loop = runLoop({
      teamDir: dir,
      maxIterations: 2,
      runIteration: async (prompt, iteration) => {
        prompts.push(prompt)
        await writeProgress(dir, { ...EMPTY_PROGRESS, currentIteration: iteration, completionSignal: true })
      }
    })
    await loop.done
    expect(prompts[0]).toContain('検査が落ちる原因は型')
  })
})
