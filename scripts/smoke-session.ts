/**
 * ClaudeSession を実プロセス相手に動かす確認スクリプト。
 *   npx tsx scripts/smoke-session.ts
 * 会話UIを作る前に、双方向 stream-json が本当に成立するかをここで担保する。
 */
import { ClaudeSession } from '../src/main/claude/session'
import { isAssistant, isInit, isResult } from '../src/shared/protocol'

const session = new ClaudeSession({ cwd: process.cwd(), model: 'haiku' })

session.on('init', (init) => {
  console.log('[init] session=%s model=%s mode=%s', init.session_id, init.model, init.permissionMode)
  console.log('[init] slash_commands: %d 件, skills: %d 件, agents: %d 件',
    init.slash_commands.length, init.skills.length, init.agents.length)
  console.log('[init] 先頭10件:', init.slash_commands.slice(0, 10).join(', '))
})

session.on('event', (e) => {
  if (isInit(e)) return
  if (isAssistant(e)) {
    for (const block of e.message.content) {
      if (block.type === 'text') console.log('[assistant]', (block as { text: string }).text)
    }
  } else if (isResult(e)) {
    console.log('[result] %s cost=$%s stop=%s', e.subtype, e.total_cost_usd, e.stop_reason)
    void session.stop().then(() => process.exit(0))
  } else {
    console.log('[%s]', e.type + (e.subtype ? ':' + e.subtype : ''))
  }
})

session.on('stderr', (s) => process.stderr.write('[stderr] ' + s))
session.on('error', (err) => { console.error('[error]', err.message); process.exit(1) })
session.on('exit', ({ code }) => console.log('[exit] code=%s', code))

session.start().then(() => session.send('Reply with exactly: pong')).catch((err) => { console.error(String(err)); process.exit(1) })
setTimeout(() => { console.error("timeout"); process.exit(1) }, 120_000)
