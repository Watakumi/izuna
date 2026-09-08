import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import {
  decide, EMPTY_PROGRESS, iterationPrompt, parseProgress, trimLearnings,
  type Progress, type Stop
} from '../shared/loop'
import { settle } from '../shared/wait'

/**
 * 自律ループの駆動部。判断は `shared/loop.ts`（純粋関数）が持つ。
 *
 * **文脈は毎回捨てる。** 反復ごとに新しいセッションを起こし、
 * 引き継ぐのは `progress.json` の中身だけ。resume はしない。
 */

export const PROGRESS_FILE = 'progress.json'

export async function readProgress(teamDir: string): Promise<Progress> {
  try {
    return parseProgress(await readFile(join(teamDir, PROGRESS_FILE), 'utf8'))
  } catch {
    return { ...EMPTY_PROGRESS }
  }
}

/**
 * 書き換え中に落ちても壊さない。**一時ファイルに書いてから置き換える。**
 * 途中まで書いたファイルが残ると、次の反復が既定に倒れて記憶を失う。
 */
export async function writeProgress(teamDir: string, progress: Progress): Promise<void> {
  await mkdir(teamDir, { recursive: true })
  const at = join(teamDir, PROGRESS_FILE)
  const tmp = `${at}.tmp`
  await writeFile(tmp, JSON.stringify({ ...progress, learnings: trimLearnings(progress.learnings) }, null, 2), 'utf8')
  await rename(tmp, at)
}

/**
 * 進捗を**宣言させる**ためのツール。
 *
 * **文面から「終わったか」を推測しない。** §7 で「拒否は結果の文面から
 * 判定してはいけない」を痛い目で学んだのと同じ規律を、進捗にも当てる。
 *
 * SDK がプロセス内に MCP サーバを持てるので、別プロセスは要らない。
 */
export function progressServer(
  teamDir: string,
  onUpdate?: (progress: Progress) => void
): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: 'izuna',
    tools: [
      tool(
        'izuna_progress',
        '反復の終わりに、進んだところと分かったことを申告する。次の反復に引き継がれるのはここに書いたものだけ。',
        {
          phase: z.enum(['planning', 'building']).describe('次の反復でやること'),
          status: z.enum(['running', 'completed', 'blocked']).describe('進めているか、終わったか、詰まったか'),
          completionSignal: z.boolean().describe('受け入れ条件を全部満たしたときだけ true'),
          learnings: z.array(z.object({
            iteration: z.number(),
            summary: z.string().describe('次の反復が知っておくべきこと'),
            filesChanged: z.array(z.string())
          })).describe('これまでの分に今回の分を足したもの。上書きしない'),
          blockers: z.array(z.string()).describe('進めない理由。status が blocked のときだけ'),
          currentIteration: z.number()
        },
        async (args) => {
          const next: Progress = {
            currentIteration: args.currentIteration,
            phase: args.phase,
            status: args.status,
            completionSignal: args.completionSignal,
            learnings: args.learnings,
            blockers: args.blockers
            // **`userFeedback` は引き継がない。** 一度渡したら消える ——
            // 残すと、人が言っていないことを何度も読ませることになる
          }
          await writeProgress(teamDir, next)
          onUpdate?.(next)
          return {
            content: [{
              type: 'text',
              text: `受け取りました（反復 ${next.currentIteration} / ${next.status}）`
            }]
          }
        }
      )
    ]
  })
}

export interface LoopOptions {
  /** 共有フォルダ（§12）。`brief.md` と `tasks/` がここにある */
  teamDir: string
  maxIterations: number
  /** 1 反復を走らせる。**呼ぶ側が新しいセッションを起こす** */
  runIteration: (prompt: string, iteration: number) => Promise<void>
  onProgress?: (progress: Progress, iteration: number) => void
}

/** 動いているループ。止める手段を必ず持たせる */
export interface RunningLoop {
  stop(): void
  readonly done: Promise<Stop>
}

/**
 * 回す。
 *
 * **失敗しても即座に諦めない**（一時的な失敗はある）が、
 * **続けて 3 回失敗したら止める** —— 同じ場所で回り続けるより、人を呼ぶほうがよい。
 */
export const MAX_CONSECUTIVE_FAILURES = 3

export function runLoop(options: LoopOptions): RunningLoop {
  let stopped = false
  const done = (async (): Promise<Stop> => {
    let failures = 0

    for (;;) {
      if (stopped) return { reason: 'stopped', detail: '人が止めました' }

      const progress = await readProgress(options.teamDir)
      const verdict = decide(progress, options.maxIterations)
      if (verdict) return verdict

      const iteration = progress.currentIteration + 1
      options.onProgress?.(progress, iteration)

      try {
        await options.runIteration(
          iterationPrompt({ progress, teamDir: options.teamDir, iteration }),
          iteration
        )
        failures = 0
      } catch (err) {
        failures++
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          return {
            reason: 'failed',
            detail: `${MAX_CONSECUTIVE_FAILURES} 回続けて失敗しました: ${String(err).slice(0, 200)}`
          }
        }
        // 少し待って試し直す。**待たずに回すと、同じ失敗を叩き続ける**
        await settle(new Promise((r) => setTimeout(r, 2000 * failures)), 30_000)
        continue
      }

      /**
       * **進んだかどうかを、ファイルで確かめる。**
       *
       * ツールを呼ばずに終わる反復がありうる。そのまま次へ行くと
       * `currentIteration` が上がらず、同じ本文で永久に回る。
       */
      const after = await readProgress(options.teamDir)
      if (after.currentIteration <= progress.currentIteration) {
        await writeProgress(options.teamDir, { ...after, currentIteration: iteration })
      }
    }
  })()

  return { stop: () => { stopped = true }, done }
}
