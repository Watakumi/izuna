/**
 * 会議の実測（§39）。
 *   npx tsx scripts/probe-meeting.ts [--members N] [--parallel] [--compact]
 * **実 API を呼ぶ。** 一時ディレクトリで司会 1・参加者 N の会議を開き、次を測る:
 *
 * 1. 司会が MCP ツールで次の話者を毎回指名するか（文面から推測しないで済むか）
 * 2. 参加者に「前の番から後の発言」だけを渡して、話が噛み合うか
 * 3. 1 発言あたりの時間と費用、参加者が全員指名されるか（`--members`）
 * 4. 参加者を resume したとき、前の会議を覚えているか（`--compact` なら `/compact` を挟んでから聞く）
 * 5. 司会が 1 つの応答で 2 人を同時に指名したとき、手が並んで走るか（`--parallel`）
 *
 * 司会と参加者の申し送りは製品と同じもの（`shared/meeting.ts`）を使う。駆動は製品と違って
 * **順番待ちを入れない** —— 手が並んで呼ばれるかを見るため。
 *
 * 2026-10-06 の 1 回目は手がすぐ返る作りで、司会は 1 ターンで指名を 6 回続けて発言を一度も読まずに
 * 閉会した。いまは参加者が話し終わるまで手が返らない（製品と同じ）。
 *
 * 結果は標準出力と `scripts/probe-meeting*.result.json`（gitignore）に残す。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSdkMcpServer, tool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { ClaudeSession } from '../src/main/claude/session'
import {
  DEFAULT_ROLES,
  MAX_TURNS,
  deltaFor,
  moderatorPrompt,
  personaPrompt,
  type Entry,
  type Role
} from '../src/shared/meeting'

const arg = (name: string): string | undefined =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined
const N = Math.min(Number(arg('--members') ?? 2), DEFAULT_ROLES.length)
const PARALLEL = process.argv.includes('--parallel')
const COMPACT = process.argv.includes('--compact')
// 反論を必ず入れる（全員が賛成して 1 周で閉じると、人数を増やした意味が測れない）
const ROLES: Role[] = [
  ...DEFAULT_ROLES.filter((r) => r.name !== 'critic').slice(0, N - 1),
  DEFAULT_ROLES.find((r) => r.name === 'critic')!
]

const root = mkdtempSync(join(tmpdir(), 'izuna-probe-meeting-'))
const meetingsDir = join(root, '.meetings')
writeFileSync(
  join(root, 'README.md'),
  '# notes\n\n個人用のメモアプリ。Electron。メモはローカルの SQLite に保存している。\n'
)

const stamp = (): string => new Date().toISOString().slice(11, 19)
const log = (...a: unknown[]): void => console.log(`[${stamp()}]`, ...a)
const AGENDA = 'メモを複数端末で同期したい。どの方式にするか（自前サーバ / iCloud / 同期しない）'
const READ_ONLY = ['Read', 'Glob', 'Grep']

const permissions: string[] = []
function wire(session: ClaudeSession, who: string): void {
  session.on('permission', (req) => {
    permissions.push(`${who}:${req.toolName}`)
    log('★ 承認', who, req.toolName)
    session.respondToPermission(req.id, { behavior: 'deny', message: 'probe' })
  })
  session.on('error', (e) => log('error', who, e.message))
}

interface Turn {
  who: string
  text: string
  ms: number
  cost: number
  /** この応答の中で呼んだ道具。1 つの assistant メッセージに複数あれば並んで呼んだ */
  toolsPerMessage: string[][]
  systems: string[]
}
const turns: Turn[] = []

/** 送って、`result` が来るまで待つ */
function turn(session: ClaudeSession, who: string, text: string, human = false): Promise<Turn> {
  return new Promise((resolve) => {
    const started = Date.now()
    const out: string[] = []
    const toolsPerMessage: string[][] = []
    const systems: string[] = []
    const onMessage = (m: SDKMessage): void => {
      if (m.type === 'system') systems.push(m.subtype)
      if (m.type === 'assistant' && !m.parent_tool_use_id) {
        const tools: string[] = []
        for (const b of m.message.content) {
          if (b.type === 'text') out.push(b.text)
          if (b.type === 'tool_use') tools.push(b.name)
        }
        if (tools.length) toolsPerMessage.push(tools)
      } else if (m.type === 'result') {
        session.off('message', onMessage)
        const t = {
          who,
          text: out.join('\n').trim(),
          ms: Date.now() - started,
          cost: m.total_cost_usd,
          toolsPerMessage,
          systems
        }
        turns.push(t)
        log(`${who} (${(t.ms / 1000).toFixed(1)}s, $${t.cost.toFixed(4)})`)
        log('  ', t.text.slice(0, 200).replace(/\n/g, ' / '))
        resolve(t)
      }
    }
    session.on('message', onMessage)
    session.send(
      text,
      [],
      human
        ? { kind: 'human' }
        : { kind: 'peer', from: 'izuna-meeting', fromMode: 'prompting', name: '会議' }
    )
  })
}

/** 手が呼ばれた区間。重なっていれば並んで走った */
const spans: Array<{ who: string; start: number; end: number }> = []
let closed: unknown = null

async function meeting(): Promise<Record<string, string | undefined>> {
  const entries: Entry[] = [{ at: new Date().toISOString(), who: 'human', text: AGENDA }]
  const seen: Record<string, number> = {}
  const members = new Map<string, ClaudeSession>()
  let spoken = 0

  const speak = async (name: string, ask: string): Promise<string> => {
    if (spoken >= MAX_TURNS)
      return `発言が ${MAX_TURNS} 回に達しました。izuna_close で閉じてください。`
    const role = ROLES.find((r) => r.name === name)!
    spoken++
    const start = Date.now()
    entries.push({
      at: new Date().toISOString(),
      who: 'moderator',
      text: `${role.title}へ: ${ask}`
    })
    let s = members.get(name)
    if (!s) {
      s = new ClaudeSession({
        cwd: root,
        settingSources: [],
        tools: READ_ONLY,
        additionalDirectories: [meetingsDir],
        appendSystemPrompt: personaPrompt(role, [meetingsDir])
      })
      wire(s, name)
      members.set(name, s)
      await s.start()
    }
    const t = await turn(s, name, deltaFor(entries, seen[name] ?? 0, ROLES))
    entries.push({ at: new Date().toISOString(), who: name, text: t.text })
    seen[name] = entries.length
    spans.push({ who: name, start, end: Date.now() })
    return `【${role.title}】${t.text}`
  }

  const server = createSdkMcpServer({
    name: 'izuna',
    tools: [
      tool(
        'izuna_next',
        '次に話す参加者を 1 人指名して聞く。その人が話し終わると、発言がこの結果として返る。',
        {
          speaker: z.enum(ROLES.map((r) => r.name) as [string, ...string[]]),
          ask: z.string()
        },
        async (a) => ({ content: [{ type: 'text', text: await speak(a.speaker, a.ask) }] })
      ),
      tool(
        'izuna_close',
        '論点が出尽くしたら会議を閉じる。',
        { decisions: z.array(z.string()), open: z.array(z.string()), actions: z.array(z.string()) },
        async (a) => {
          closed = a
          return {
            content: [{ type: 'text', text: '議事録に書きました。ここで会議を終えてください。' }]
          }
        }
      )
    ]
  })

  const moderator = new ClaudeSession({
    cwd: root,
    settingSources: [],
    tools: [],
    allowedTools: ['mcp__izuna__izuna_next', 'mcp__izuna__izuna_close'],
    appendSystemPrompt:
      moderatorPrompt(ROLES) +
      (PARALLEL
        ? '\n最初の指名だけは、2 人に同じ問いを同時に聞く。1 つの応答の中で izuna_next を 2 回並べて呼ぶこと。'
        : ''),
    mcpServers: { izuna: server }
  })
  wire(moderator, 'moderator')
  await moderator.start()
  await turn(moderator, 'moderator', `議題: ${AGENDA}\n\n会議を始めてください。`, true)
  log('閉会', closed ? JSON.stringify(closed).slice(0, 300) : '（閉じずに終わった）')

  const ids = Object.fromEntries([...members].map(([n, s]) => [n, s.sessionId]))
  await moderator.stop()
  for (const s of members.values()) await s.stop()
  return ids
}

/** 参加者を resume して前回を聞く。`--compact` なら先に `/compact` を送る */
async function recall(
  name: string,
  id: string | undefined
): Promise<{ text: string; compacted: boolean } | null> {
  if (!id) return null
  const role = ROLES.find((r) => r.name === name)!
  const s = new ClaudeSession({
    cwd: root,
    settingSources: [],
    tools: READ_ONLY,
    resume: id,
    appendSystemPrompt: personaPrompt(role, [meetingsDir])
  })
  wire(s, `${name}(resume)`)
  await s.start()
  let compacted = false
  if (COMPACT) {
    const c = await turn(s, `${name}(compact)`, '/compact', true)
    compacted = c.systems.includes('compact_boundary')
    log('compact の system', c.systems.join(','))
  }
  const t = await turn(
    s,
    `${name}(resume)`,
    '新しい会議です。前回の会議で、あなたは何を主張し、ほかの参加者は何と言い、何が決まりましたか。'
  )
  await s.stop()
  return { text: t.text, compacted }
}

// tsx は cjs 出力なので top-level await が使えない（§7）
async function main(): Promise<void> {
  const started = Date.now()
  const ids = await meeting()
  const meetingMs = Date.now() - started
  log('session ids', ids)
  const target = Object.keys(ids)[0]
  const remembered = await recall(target, ids[target])

  const overlaps = spans.flatMap((a, i) =>
    spans
      .slice(i + 1)
      .filter((b) => a.start < b.end && b.start < a.end)
      .map((b) => `${a.who}×${b.who}`)
  )
  const moderatorTurns = turns.filter((t) => t.who === 'moderator')
  const result = {
    at: new Date().toISOString(),
    flags: { members: ROLES.map((r) => r.name), parallel: PARALLEL, compact: COMPACT },
    meetingSeconds: Math.round(meetingMs / 1000),
    spoken: Object.fromEntries(
      ROLES.map((r) => [r.name, spans.filter((s) => s.who === r.name).length])
    ),
    closed: !!closed,
    minutes: closed,
    /** 1 つの応答で izuna_next を 2 つ以上並べた回数 */
    parallelCalls: moderatorTurns
      .flatMap((t) => t.toolsPerMessage)
      .filter((ts) => ts.filter((n) => n.endsWith('izuna_next')).length >= 2).length,
    overlaps,
    permissions,
    // `total_cost_usd` はセッションの累計。話者ごとの最後の値を足す
    totalCost: [...new Map(turns.map((t) => [t.who, t.cost])).values()].reduce((a, c) => a + c, 0),
    recall: remembered,
    turns
  }
  const suffix = [N !== 2 ? `m${N}` : '', PARALLEL ? 'parallel' : '', COMPACT ? 'compact' : '']
    .filter(Boolean)
    .join('.')
  writeFileSync(
    join(import.meta.dirname, `probe-meeting${suffix ? '.' + suffix : ''}.result.json`),
    JSON.stringify(result, null, 2)
  )
  const { turns: _t, minutes: _m, ...summary } = result
  console.log(JSON.stringify(summary, null, 2))
}

void main().then(() => process.exit(0))
