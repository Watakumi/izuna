/**
 * **ツールの結果を、モデルへ行く前に差し替えられるか**の実測（利用者の判断、2026-09-14）。
 *   npx tsx scripts/probe-mask.ts
 *
 * 機密を API に入れずに Claude に作業させたい、という要求から。SDK 0.3.266 の型には
 * `PostToolUseHookSpecificOutput.updatedToolOutput`（「モデルへ送られる前にツールの出力を
 * 差し替える」）があるが、**型にあることと動くことは別**なので測る。
 *
 * 1. ブレインの `Read` の結果が差し替わり、モデルが**札しか見ない**か
 * 2. **実行役（サブエージェント）のツールでも `PostToolUse` が鳴るか**
 *    （9-09 の probe では実行役の節目は `SubagentStart` / `SubagentStop` しか鳴らなかった）
 * 3. `~/.claude/projects/*.jsonl` に残るのは**差し替え後**か生か
 * 4. `Bash` の出力にも効くか（`tool_response` の形も控える）
 *
 * **実 API を呼ぶ。** 一時ディレクトリで作り物の鍵を読ませるだけで、本物の鍵は使わない。
 * 結果は `scripts/probe-mask.result.json`（gitignore）。
 */
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  realpathSync
} from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeSession } from '../src/main/claude/session'

/** 作り物の鍵。**行を分けて組む** —— そのまま書くと gitleaks が push を止める（§26 の罠） */
const SECRET = ['sk', 'probe', 'AAAABBBBCCCCDDDD', 'EEEEFFFF0011223344'].join('-')
const MARK = '⟦IZUNA_SECRET_1⟧'

const root = mkdtempSync(join(tmpdir(), 'izuna-probe-mask-'))
writeFileSync(join(root, 'secret.env'), `API_KEY=${SECRET}\nPORT=4649\n`)

const stamp = (): string => new Date().toISOString().slice(11, 19)
const log = (...a: unknown[]): void => console.log(`[${stamp()}]`, ...a)

/** 鳴った PostToolUse の記録。誰の・何の・差し替えたか */
const masked: number[] = []
const texts: Array<{ who: string; text: string }> = []
let sessionId: string | null = null

const session = new ClaudeSession({
  cwd: root,
  permissionMode: 'default',
  settingSources: ['project', 'local']
  // **覆いは既定で掛かる**（`mask` を渡さない）。ここで測るのは製品が通る経路そのもの
})

session.on('masked', (n) => {
  masked.push(n)
  log('masked', `覆っている数 ${n}`)
})

session.on('permission', (req) => {
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
session.on('message', (m: SDKMessage) => {
  if (m.type === 'system' && m.subtype === 'init') {
    sessionId = m.session_id
    log('init', m.session_id, m.model)
  } else if (m.type === 'assistant') {
    for (const b of m.message.content) {
      if (b.type === 'text' && b.text.trim()) {
        const who = m.parent_tool_use_id ? 'executor' : 'brain'
        texts.push({ who, text: b.text.trim() })
        log(who, b.text.trim().slice(0, 200).replace(/\n/g, ' '))
      }
      if (b.type === 'tool_use')
        log(m.parent_tool_use_id ? 'executor' : 'brain', 'tool_use', b.name)
    }
  } else if (
    m.type === 'system' &&
    (m.subtype === 'task_started' || m.subtype === 'task_notification')
  ) {
    if (m.subtype === 'task_started') started++
    else notified++
    log('lifecycle', m.subtype, `${notified}/${started}`)
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
async function waitForTasks(maxMs: number): Promise<boolean> {
  const end = Date.now() + maxMs
  while (Date.now() < end) {
    if (started > 0 && notified >= started) return true
    await sleep(1000)
  }
  return false
}

/** 会話の記録に生の鍵が残っているか。`~/.claude/projects/<cwd を潰した名前>/<id>.jsonl` */
function transcriptCheck(): { file: string | null; raw: number; masked: number } {
  // **解決後の絶対パスで探す。** macOS の `/var` は `/private/var` への symlink で、
  // claude は解決後の名前でディレクトリを作る（§10 の `removeWorktree` と同じ罠）
  const dir = join(
    homedir(),
    '.claude',
    'projects',
    realpathSync(root).replace(/[^a-zA-Z0-9]/g, '-')
  )
  if (!sessionId || !existsSync(dir)) return { file: null, raw: 0, masked: 0 }
  // `.jsonl` だけを見る。同じ名前で始まるディレクトリがあると readFileSync が EISDIR で落ちる
  const hit = readdirSync(dir).find((f) => f.startsWith(sessionId) && f.endsWith('.jsonl'))
  if (!hit) return { file: null, raw: 0, masked: 0 }
  const body = readFileSync(join(dir, hit), 'utf8')
  return {
    file: join(dir, hit),
    raw: body.split(SECRET).length - 1,
    masked: body.split(MARK).length - 1
  }
}

function finish(code: number): void {
  const said = (who: string): string[] =>
    texts.filter((t) => t.who === who).map((t) => t.text.replace(/\s+/g, ' '))
  const brainSaw = said('brain').join(' ')
  const execSaw = said('executor').join(' ')
  const result = {
    at: new Date().toISOString(),
    root,
    /** 1. ブレインの Read が差し替わったか */
    brain: {
      sawSecret: brainSaw.includes(SECRET),
      sawMark: brainSaw.includes(MARK) || brainSaw.includes('IZUNA_SECRET')
    },
    /** 2. 実行役のツールでも覆えたか */
    executor: {
      sawSecret: execSaw.includes(SECRET),
      sawMark: execSaw.includes(MARK) || execSaw.includes('IZUNA_SECRET')
    },
    /** 3. 記録に残るのは生か札か */
    transcript: transcriptCheck(),
    /** 4. 覆った回数（実値は残さない） */
    masked,
    /** 5. 戻す側。モデルが札を書き戻したら、ディスクには実値が落ちているか */
    wroteBack: existsSync(join(root, 'out.txt'))
      ? {
          hasSecret: readFileSync(join(root, 'out.txt'), 'utf8').includes(SECRET),
          hasMark: readFileSync(join(root, 'out.txt'), 'utf8').includes('IZUNA_SECRET')
        }
      : null,
    texts
  }
  writeFileSync(join(__dirname, 'probe-mask.result.json'), JSON.stringify(result, null, 2))
  console.log('\n=== 結果 ===')
  console.log(JSON.stringify({ ...result, texts: undefined, fired: undefined }, null, 2))
  console.log(
    `\nPostToolUse が鳴った回数: ${fired.length}（うち実行役 ${result.executor.hooksFired}）`
  )
  void session.stop().finally(() => process.exit(code))
}

void session.start().then(async () => {
  // 1・4. ブレインに読ませる。Read と Bash の両方
  await turn(
    `secret.env を Read で読み、API_KEY の値をそのまま 1 行で言ってください。そのあと Bash で cat secret.env も実行し、そちらで見えた API_KEY の値も 1 行で言ってください。値は加工せず、見えたままを書いてください。`
  )
  // 2. 実行役に読ませる
  await turn(
    `Agent ツールを isolation: "worktree" で 1 つ起こし、その実行役に secret.env を読ませて API_KEY の値を報告させてください。実行役が見た値をそのまま伝えてください。`
  )
  await waitForTasks(180_000)

  // 5. **戻す側。** モデルは札しか知らないので、札のまま書かせる。
  // 実行の直前に Izuna が実値へ戻すなら、ディスクには本物が落ちる
  await turn(
    `secret.env の API_KEY の値を、見えたまま out.txt に 1 行で書いてください（Write でも Bash でも構いません）。`
  )
  await sleep(2000)
  finish(0)
})
