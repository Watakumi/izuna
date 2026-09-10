/**
 * ブレインと実行役の実測（§12「まだ測っていないこと」、GOAL.md 測り方）。
 *   npx tsx scripts/probe-team.ts
 * **実 API を呼ぶ。** 一時リポジトリでブレインを起こし、背景の実行役 2 つに
 * `EnterWorktree` → ファイルを書く → commit をさせ、次を測る:
 *
 * 1. どの hook が鳴るか（SubagentStart / SubagentStop / TeammateIdle / WorktreeCreate …）
 * 2. 実行役 2 つが**別の worktree** に書き、本体の作業ツリーを汚さないか
 * 3. 実行役の承認が host（人）に `agentID` 付きで来るか
 * 4. 実行役が止まったあと、ブレインが追加の指示を出して届くか（SendMessage）
 *
 * 結果は標準出力と `scripts/probe-team.result.json`（gitignore）に残す。
 */
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { HookInput, HookJSONOutput, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeSession } from '../src/main/claude/session'
import { TEAMMATE_HOOKS, teammateEventOf, type TeammateEvent } from '../src/shared/teammate'

const root = mkdtempSync(join(tmpdir(), 'izuna-probe-team-'))
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' })
git('init', '-q', '-b', 'main')
git('config', 'user.email', 'probe@example.invalid')
git('config', 'user.name', 'probe')
mkdirSync(join(root, '.claude'), { recursive: true })
writeFileSync(
  join(root, '.claude', 'settings.json'),
  JSON.stringify({ worktree: { baseRef: 'head', bgIsolation: 'worktree' } }, null, 2)
)
writeFileSync(join(root, 'README.md'), '# probe\n')
git('add', '-A')
git('commit', '-q', '-m', 'init')
const headBefore = git('rev-parse', 'HEAD').trim()

const hooks: Array<{ name: string; event: TeammateEvent | null; agent?: string }> = []
const permissions: Array<{ tool: string; agentId?: string }> = []
const lifecycle: string[] = []
const texts: string[] = []
const stamp = (): string => new Date().toISOString().slice(11, 19)
const log = (...a: unknown[]): void => console.log(`[${stamp()}]`, ...a)

/** `--mode auto` などで権限モードを変えて測る（既定は default。auto は分類器に任せる） */
const modeArg = process.argv[process.argv.indexOf('--mode') + 1]
const permissionMode = (process.argv.includes('--mode') ? modeArg : 'default') as
  'default' | 'auto' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk' | 'plan'
const toolUses: Array<{ who: string; name: string }> = []

const session = new ClaudeSession({
  cwd: root,
  permissionMode,
  settingSources: ['project', 'local'],
  hooks: Object.fromEntries(
    TEAMMATE_HOOKS.map((name) => [
      name,
      [
        {
          hooks: [
            async (input: HookInput): Promise<HookJSONOutput> => {
              const event = teammateEventOf(input)
              hooks.push({ name: input.hook_event_name, event, agent: input.agent_id })
              log(
                'hook',
                input.hook_event_name,
                event ? `${event.kind} ${event.agent} ${event.target}` : ''
              )
              return {}
            }
          ]
        }
      ]
    ])
  )
})

session.on('permission', (req) => {
  permissions.push({ tool: req.toolName, agentId: req.agentId })
  log(
    'permission',
    req.toolName,
    req.agentId ? `agent=${req.agentId.slice(0, 8)}` : 'brain',
    '→ allow'
  )
  session.respondToPermission(req.id, { behavior: 'allow' })
})
session.on('error', (e) => {
  log('error', e.message)
  finish(1)
})

let resolveTurn: (() => void) | null = null
let started = 0
let notified = 0
const toolNames = new Map<string, string>()
/** 気になるツールの結果はそのまま残す（EnterWorktree が子から使えるか、SendMessage が届くか） */
const toolResults: Array<{ tool: string; who: string; text: string }> = []
const WATCH = new Set(['EnterWorktree', 'SendMessage', 'ListAgents', 'Agent'])
session.on('message', (m: SDKMessage) => {
  if (m.type === 'system' && m.subtype === 'init') log('init', m.session_id, m.model)
  else if (m.type === 'assistant') {
    for (const b of m.message.content) {
      if (b.type === 'text' && b.text.trim()) {
        const who = m.parent_tool_use_id ? 'executor' : 'brain'
        texts.push(`${who}: ${b.text.trim()}`)
        log(who, b.text.trim().slice(0, 160).replace(/\n/g, ' '))
      }
      if (b.type === 'tool_use') {
        toolNames.set(b.id, b.name)
        toolUses.push({ who: m.parent_tool_use_id ? 'executor' : 'brain', name: b.name })
        log(m.parent_tool_use_id ? 'executor' : 'brain', 'tool_use', b.name)
      }
    }
  } else if (m.type === 'user' && Array.isArray(m.message.content)) {
    for (const b of m.message.content) {
      if (typeof b !== 'object' || b.type !== 'tool_result') continue
      const tool = toolNames.get(b.tool_use_id) ?? '?'
      if (!WATCH.has(tool)) continue
      const text = (
        Array.isArray(b.content)
          ? b.content.map((c) => ('text' in c ? c.text : '')).join(' ')
          : String(b.content ?? '')
      )
        .replace(/\s+/g, ' ')
        .slice(0, 400)
      toolResults.push({ tool, who: m.parent_tool_use_id ? 'executor' : 'brain', text })
      log('tool_result', tool, text.slice(0, 200))
    }
  } else if (
    m.type === 'system' &&
    (m.subtype === 'task_started' ||
      m.subtype === 'task_notification' ||
      m.subtype === 'task_progress')
  ) {
    lifecycle.push(m.subtype)
    if (m.subtype === 'task_started') started++
    if (m.subtype === 'task_notification') notified++
    if (m.subtype !== 'task_progress')
      log('lifecycle', m.subtype, 'status' in m ? m.status : '', `${notified}/${started}`)
  } else if (m.type === 'result') {
    log('result', m.subtype)
    resolveTurn?.()
  }
})

const turn = (text: string): Promise<void> =>
  new Promise((r) => {
    resolveTurn = r
    session.send(text)
  })
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** 背景の実行役が全部終わる（通知が起動数に追いつく）まで待つ。上限あり */
async function waitForTasks(maxMs: number): Promise<boolean> {
  const end = Date.now() + maxMs
  while (Date.now() < end) {
    if (started > 0 && notified >= started) return true
    await sleep(1000)
  }
  return false
}
/** 通知のあとブレインが目を覚まして返事を終えるのを待つ。来なければ上限で諦める */
const waitForResult = (maxMs: number): Promise<boolean> =>
  new Promise((r) => {
    const t = setTimeout(() => {
      resolveTurn = null
      r(false)
    }, maxMs)
    resolveTurn = () => {
      clearTimeout(t)
      r(true)
    }
  })

function finish(code: number): void {
  const worktrees = git('worktree', 'list', '--porcelain')
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice(9))
  const mainTree = readdirSync(root).filter(
    (f) => f !== '.git' && f !== '.claude' && f !== 'README.md'
  )
  const written = worktrees
    .filter((w) => w !== root)
    .map((w) => ({
      path: w,
      branch: execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: w,
        encoding: 'utf8'
      }).trim(),
      notes: existsSync(join(w, 'notes')) ? readdirSync(join(w, 'notes')) : [],
      log: execFileSync('git', ['log', '--oneline'], { cwd: w, encoding: 'utf8' })
        .trim()
        .split('\n')
    }))
  const result = {
    at: new Date().toISOString(),
    root,
    permissionMode,
    toolUses: {
      executor: toolUses.filter((t) => t.who === 'executor').map((t) => t.name),
      brain: toolUses.filter((t) => t.who === 'brain').map((t) => t.name)
    },
    hooksFired: [...new Set(hooks.map((h) => h.name))],
    hookCount: hooks.length,
    hooks: hooks.map((h) => ({
      name: h.name,
      kind: h.event?.kind,
      agent: h.event?.agent,
      target: h.event?.target,
      note: h.event?.note
    })),
    permissions,
    lifecycle: [...new Set(lifecycle)],
    tasks: { started, notified },
    toolResults,
    worktrees: written,
    mainTreeExtra: mainTree,
    mainHeadUnchanged: git('rev-parse', 'HEAD').trim() === headBefore,
    texts
  }
  writeFileSync(
    join(
      __dirname,
      `probe-team${process.argv.includes('--isolation') ? '.isolation' : ''}${permissionMode !== 'default' ? `.${permissionMode}` : ''}${process.argv.includes('--risky') ? '.risky' : ''}.result.json`
    ),
    JSON.stringify(result, null, 2)
  )
  console.log('\n=== 結果 ===')
  console.log(JSON.stringify({ ...result, texts: undefined }, null, 2))
  void session.stop().then(() => process.exit(code))
}

session
  .start()
  .then(async () => {
    // `--isolation`: 実行役に EnterWorktree を呼ばせず、Agent ツールの isolation: "worktree" で分ける
    const isolation = process.argv.includes('--isolation')
    log(
      'mode',
      isolation ? 'Agent(isolation: worktree)' : 'executor が EnterWorktree',
      `permissionMode=${permissionMode}`
    )
    // `--risky`: 分類器が止めるはずの操作を実行役にやらせて、人に来るかを見る。
    // 消させるのは probe が tmp に作った空のディレクトリ（リポジトリの外）。force push の先は無い remote
    const outside = mkdtempSync(join(tmpdir(), 'izuna-probe-outside-'))
    writeFileSync(join(outside, 'keep.txt'), 'outside\n')
    const risky = process.argv.includes('--risky')
      ? ` (3c) try \`git push --force origin main\` and report the error, (3d) delete the directory ${outside} and everything in it using the shell (it is outside the repository) and report whether it worked,`
      : ''
    await turn(
      isolation
        ? [
            'Use the Agent tool to start TWO subagents in the background at the same time (subagent_type: general-purpose, run_in_background: true, isolation: "worktree").',
            'Call the first one "alpha" and the second one "beta".',
            'Each subagent must: (1) run `pwd` and `git rev-parse --abbrev-ref HEAD` to learn where it is, (2) create the file notes/<name>.md containing the single line "from <name>", (3) run `git add -A && git commit -m "<name>"`, (3b) create a directory scratch/ with one file inside and then remove that directory recursively with the shell,' +
              risky +
              ' (4) finish by reporting the absolute path of its working directory and its branch name.',
            'Wait for both background task notifications. Then reply with exactly two lines, "WT: <path> <branch>" for each subagent, and nothing else.'
          ].join(' ')
        : [
            'Use the Agent tool to start TWO subagents in the background at the same time (subagent_type: general-purpose, run_in_background: true).',
            'Call the first one "alpha" and the second one "beta".',
            'Each subagent must: (1) call EnterWorktree with its own name as the worktree name, (2) inside that worktree create the file notes/<name>.md containing the single line "from <name>", (3) run `git add -A && git commit -m "<name>"` in that worktree, (4) finish by reporting the absolute path of its worktree.',
            'Wait for both background task notifications. Then reply with exactly two lines, "WT: <path>" for each worktree, and nothing else.'
          ].join(' ')
    )
    log('turn 1 returned. 背景の実行役を待つ')
    const allDone = await waitForTasks(6 * 60_000)
    log('tasks', allDone ? '全部終わった' : '終わらなかった', `${notified}/${started}`)
    if (allDone) log('brain の返事', (await waitForResult(90_000)) ? '来た' : '来なかった')
    await turn(
      [
        'Now give each subagent a follow-up instruction. Use SendMessage (or, if those agents are gone, ListAgents to check and say so) to ask alpha and beta to append the line "second" to their notes file and commit again.',
        'Report the outcome in one line per agent: "FOLLOWUP <name>: delivered" or "FOLLOWUP <name>: <what happened>".'
      ].join(' ')
    )
    // 追加指示で実行役が起きるなら、その完了も待つ
    const before = notified
    await sleep(5000)
    if (started > before) {
      await waitForTasks(3 * 60_000)
      await waitForResult(60_000)
    }
    finish(0)
  })
  .catch((e) => {
    log('fatal', String(e))
    finish(1)
  })

setTimeout(() => {
  log('timeout')
  finish(1)
}, 12 * 60_000)
