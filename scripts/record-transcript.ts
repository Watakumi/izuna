/**
 * ClaudeSession が出す SDKMessage の並びを、そのまま録る。
 *
 *   npx tsx scripts/record-transcript.ts
 *
 * **実 API を呼ぶ。** 会話ビューの状態モデル(段1-b)が食べるのは生 NDJSON では
 * なく SDKMessage なので、record-fixture.ts とは別に要る。
 * あちらは「CLI が何を吐いたか」、こちらは「アプリに何が届くか」の化石である。
 *
 * `settingSources: []` で録る。利用者のプラグイン hook が混ざらず、
 * 過去セッションの要約も入らないので、そのまま版管理に入れられる。
 *
 * 狙って踏ませるもの: thinking / tool_use / tool_result / stream_event の逐次差分 /
 * 権限の往復。薄い fixture では状態モデルを検査できない。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClaudeSession } from '../src/main/claude/session'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'test', 'fixtures', 'transcript-tools.ndjson')

const cwd = mkdtempSync(join(tmpdir(), 'izuna-rec-'))
const lines: string[] = []
let asked = 0

const session = new ClaudeSession({
  cwd,
  model: 'haiku',
  permissionMode: 'default',
  settingSources: []
})

session.on('permission', (req) => {
  asked++
  // 録画なので許可して先へ進める。拒否の側は smoke-permission.ts が見る。
  console.log(`  [承認 ${asked}] ${req.toolName} → allow`)
  session.respondToPermission(req.id, { behavior: 'allow' })
})

session.on('message', (m) => {
  lines.push(JSON.stringify(m))
  process.stdout.write('.')
  if (m.type === 'result') {
    console.log(`\n${lines.length} 件 / 承認 ${asked} 回`)
    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, lines.join('\n') + '\n', 'utf8')
    console.log(`${OUT} に録った`)
    void session.stop().then(() => process.exit(asked > 0 ? 0 : 1))
  }
})

session.on('error', (e) => { console.error('[error]', e.message); process.exit(1) })

session
  .start()
  .then(() => {
    console.log('cwd:', cwd)
    session.send(
      'Do these in order, then stop. ' +
        '1) Write a file notes.txt containing exactly: hello izuna. ' +
        '2) Read notes.txt back. ' +
        '3) Reply with the file contents in one short sentence.'
    )
  })
  .catch((e) => { console.error(String(e)); process.exit(1) })

setTimeout(() => { console.error('\n180 秒で終わらなかった'); process.exit(1) }, 180_000)
