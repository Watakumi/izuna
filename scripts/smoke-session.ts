/**
 * いま CLI と話せるかを人が目で見る。
 *   npx tsx scripts/smoke-session.ts
 * **実 API を呼ぶ。** 承認の往復は smoke-permission.ts が見る。
 */
import { ClaudeSession } from '../src/main/claude/session'

const session = new ClaudeSession({ cwd: process.cwd(), model: 'haiku' })

session.on('message', (m) => {
  if (m.type === 'system' && m.subtype === 'init') {
    console.log('[init] session=%s model=%s mode=%s', m.session_id, m.model, m.permissionMode)
  } else if (m.type === 'assistant') {
    for (const b of m.message.content) {
      if (b.type === 'text' && b.text.trim()) console.log('[assistant]', b.text.trim())
    }
  } else if (m.type === 'result') {
    console.log('[result] %s cost=$%s', m.subtype, 'total_cost_usd' in m ? m.total_cost_usd : '-')
    void session.stop().then(() => process.exit(0))
  }
})

session.on('permission', (req) => {
  // ここに来たら想定外(pong を返すだけの依頼でツールは要らない)。落とさず拒否して先へ。
  console.log('[permission] 想定外の要求:', req.toolName, '→ deny')
  session.respondToPermission(req.id, { behavior: 'deny', message: 'スモークではツールを使わない' })
})

session.on('error', (e) => {
  console.error('[error]', e.message)
  process.exit(1)
})

session
  .start()
  .then(async () => {
    const commands = await session.slashCommands()
    console.log(
      '[/] %d 件。先頭5件: %s',
      commands.length,
      commands
        .slice(0, 5)
        .map((c) => '/' + c.name)
        .join(', ')
    )
    session.send('Reply with exactly: pong')
  })
  .catch((e) => {
    console.error(String(e))
    process.exit(1)
  })

setTimeout(() => {
  console.error('timeout')
  process.exit(1)
}, 120_000)
