/**
 * ClaudeSession が出す SDKMessage の並びを、そのまま録る。
 *
 *   npx tsx scripts/record-transcript.ts [tools|teammate]
 *
 * **実 API を呼ぶ。** 状態モデルが食べるのは生 NDJSON ではなく SDKMessage なので、
 * `record-fixture.ts` とは別に要る。あちらは「CLI が何を吐いたか」、
 * こちらは「アプリに何が届くか」の化石である。
 *
 * `settingSources: []` で録る。利用者のプラグイン hook が混ざらず、
 * 過去セッションの要約も入らないので、そのまま版管理に入れられる。
 * 加工しない。整形も間引きもしない。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClaudeSession } from '../src/main/claude/session'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

type Kind = 'tools' | 'teammate'
type Frame = { type: string; subtype?: string }

const SCENARIOS: Record<Kind, { out: string; prompt: string; until: (m: Frame) => boolean }> = {
  // 段1-b の材料。thinking / tool_use / tool_result / 逐次差分 / 承認
  tools: {
    out: 'transcript-tools.ndjson',
    prompt:
      'Do these in order, then stop. ' +
      '1) Write a file notes.txt containing exactly: hello izuna. ' +
      '2) Read notes.txt back. ' +
      '3) Reply with the file contents in one short sentence.',
    until: (m) => m.type === 'result'
  },
  // 段4 の材料。ブレインが実行役を起こし、実行役の承認と発話が届くところ
  teammate: {
    out: 'transcript-teammate.ndjson',
    prompt:
      'Use the Task tool (subagent_type "general-purpose") to spawn ONE subagent, and WAIT for it to finish. ' +
      'Tell the subagent to create a file named from-executor.txt in the current directory ' +
      'containing exactly: done by executor. ' +
      'Do not create the file yourself. Report what the subagent did.',
    // **result より task_notification が先に来る。** result で切ると実行役を取り逃がす
    // （一度それで「承認 0 件」という誤った結論を出しかけた）
    until: (m) => m.type === 'system' && m.subtype === 'task_notification'
  }
}

async function record(kind: Kind): Promise<void> {
  const scenario = SCENARIOS[kind]
  const out = join(ROOT, 'test', 'fixtures', scenario.out)
  const cwd = mkdtempSync(join(tmpdir(), `izuna-rec-${kind}-`))
  const lines: string[] = []
  let asked = 0

  console.log(`[${kind}] cwd: ${cwd}`)
  const session = new ClaudeSession({ cwd, model: 'haiku', permissionMode: 'default', settingSources: [] })

  session.on('permission', (req) => {
    asked++
    console.log(`\n  [承認 ${asked}] ${req.toolName} / agentId=${req.agentId ?? '(ブレイン本体)'} → allow`)
    session.respondToPermission(req.id, { behavior: 'allow' })
  })

  try {
    await new Promise<void>((resolve, reject) => {
      session.on('message', (m) => {
        lines.push(JSON.stringify(m))
        process.stdout.write('.')
        if (scenario.until(m as Frame)) resolve()
      })
      session.on('error', reject)
      session.start().then(() => session.send(scenario.prompt)).catch(reject)
      setTimeout(() => reject(new Error('240 秒で終わらなかった')), 240_000)
    })
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, lines.join('\n') + '\n', 'utf8')
    console.log(`\n[${kind}] ${lines.length} 件 / 承認 ${asked} 回 → ${out}`)
  } finally {
    await session.stop()
  }
}

async function main(): Promise<void> {
  const asked = process.argv[2] as Kind | undefined
  const kinds: Kind[] = asked && asked in SCENARIOS ? [asked] : (Object.keys(SCENARIOS) as Kind[])
  for (const kind of kinds) await record(kind)
  console.log('\nsession_id・cwd・uuid など環境依存の値が入る。commit 前に一度目で見ること。')
  process.exit(0)
}

main().catch((err) => {
  console.error(String(err))
  process.exit(1)
})
