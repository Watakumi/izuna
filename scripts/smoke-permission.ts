/**
 * 権限承認の握手が成立するかを見る。CLAUDE.md §6 の答え合わせ。
 *
 *   npx tsx scripts/smoke-permission.ts
 *
 * **実 API を呼ぶ。** 生の NDJSON を自前で読んでいたときは `can_use_tool` が
 * 一度も飛んでこず、何も聞かれずに自動拒否されていた。SDK 経由で
 * ホストとして名乗れば飛んでくるはず —— それをここで確かめる。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeSession } from '../src/main/claude/session'

const cwd = mkdtempSync(join(tmpdir(), 'izuna-perm-'))
const session = new ClaudeSession({ cwd, model: 'haiku', permissionMode: 'default' })

let asked = 0

session.on('permission', (req) => {
  asked++
  console.log('\n★ 承認を求められた')
  console.log('   tool      :', req.toolName)
  console.log('   input     :', JSON.stringify(req.input).slice(0, 160))
  console.log('   toolUseId :', req.toolUseId)
  console.log('   suggestions:', JSON.stringify(req.suggestions ?? []).slice(0, 300))
  // 1 件目は許可、2 件目以降は拒否して、両方向が通ることを見る
  if (asked === 1) {
    console.log('   → allow で返す')
    session.respondToPermission(req.id, { behavior: 'allow' })
  } else {
    console.log('   → deny で返す')
    session.respondToPermission(req.id, { behavior: 'deny', message: 'スモークなので拒否' })
  }
})

session.on('message', (m) => {
  if (m.type === 'assistant') {
    for (const b of m.message.content) {
      if (b.type === 'text' && b.text.trim()) console.log('[text]', b.text.trim().slice(0, 200))
      if (b.type === 'tool_use') console.log('[tool_use]', b.name)
    }
  } else if (m.type === 'result') {
    console.log('\n[result]', m.subtype, '/ 承認を求められた回数:', asked)
    void session.stop().then(() => {
      console.log(asked > 0 ? '\n握手は成立している。§6 は解決。' : '\n握手が成立していない。§6 は未解決のまま。')
      process.exit(asked > 0 ? 0 : 1)
    })
  }
})

session.on('error', (e) => { console.error('[error]', e.message); process.exit(1) })

session
  .start()
  .then(async () => {
    console.log('cwd:', cwd)
    console.log('/ コマンド:', (await session.slashCommands()).length, '件')
    session.send('Create a file named hello.txt containing the word hi in the current directory. Then stop.')
  })
  .catch((e) => { console.error(String(e)); process.exit(1) })

setTimeout(() => { console.error('\n120 秒で終わらなかった'); process.exit(1) }, 120_000)
