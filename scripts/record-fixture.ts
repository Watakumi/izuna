/**
 * 実セッションの NDJSON を、そのまま fixture として録る。
 *
 *   npx tsx scripts/record-fixture.ts
 *
 * **実 API を呼ぶ。**(haiku に "pong" と返させるだけなので費用はごく小さい)
 *
 * なぜ録るのか: ワイヤ形式は公開仕様ではなく、CLI が上がれば黙って変わりうる。
 * 録った生の行を版管理に入れておくと、**パーサの検査に実 API も網も要らなくなる**。
 * smoke-session.ts が「いま CLI と話せるか」を見るのに対し、
 * こちらは「そのとき CLI が何を吐いたか」を化石として残す係である。
 *
 * 加工しない。整形も間引きもしない。加工した時点で、それは観測ではなく解釈になる。
 *
 * **2 本録る。** hook がプラグイン経由で過去セッションの要約(私的な会話内容)を
 * 注入するため、実セッションの全記録はそのままでは版管理に入れられない。
 * 後から削るのは「加工しない」に反するので、代わりに**観測条件を統制する**。
 *
 *   session-safe.ndjson  --safe-mode で録る。版管理に入る。パーサの門はこれ
 *   session-full.ndjson  素で録る。gitignore。init の実物を見るための手元用
 *
 * safe 版では plugins / skills / custom commands が落ちるので slash_commands は
 * ほぼ空になる。/ パレットの材料を見たいときは full 版を使うこと。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { locateClaude, loginShellEnv } from '../src/main/claude/locate'
import { userInput } from './protocol'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'test', 'fixtures')

type Mode = 'safe' | 'full'

const OUT: Record<Mode, string> = {
  safe: join(OUT_DIR, 'session-safe.ndjson'),
  full: join(OUT_DIR, 'session-full.ndjson')
}

// ClaudeSession と同じ引数を、意図的に**べた書き**する。
// セッション層が引数を変えたら fixture との対応が切れるので、
// ここが写しであること自体を、テストが session.ts と突き合わせて見る。
function argsFor(mode: Mode): string[] {
  // --safe-mode は hook / plugins / skills / custom commands をまとめて落とす。
  // hook だけを落とす手段は無い(--bare は認証が API キー固定になるので使えない)。
  return mode === 'safe' ? [...BASE_ARGS, '--safe-mode'] : [...BASE_ARGS]
}

const BASE_ARGS = [
  '--print',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--replay-user-messages',
  '--permission-prompts',
  'host',
  '--model',
  'haiku'
]

async function record(mode: Mode, bin: string, env: NodeJS.ProcessEnv): Promise<void> {
  const lines: string[] = []
  const out = OUT[mode]
  console.log(`\n[${mode}] ${argsFor(mode).join(' ')}`)

  const child = spawn(bin, argsFor(mode), { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (s: string) => process.stderr.write('[stderr] ' + s))

  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity })

  const done = new Promise<void>((resolve) => {
    reader.on('line', (line) => {
      lines.push(line)
      process.stdout.write('.')
      // result が来たら 1 ターン終わり。
      if (line.includes('"type":"result"')) resolve()
    })
    child.on('exit', () => resolve())
  })

  child.stdin.write(JSON.stringify(userInput('Reply with exactly: pong')) + '\n')

  // macOS に timeout(1) が無いので、自前で持つ(CLAUDE.md §7 の罠)。
  const timer = setTimeout(() => {
    console.error('\n120 秒で応答が終わらなかった。録画を中止する')
    process.exit(1)
  }, 120_000)

  await done
  clearTimeout(timer)
  child.stdin.end()
  child.kill('SIGTERM')

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(out, lines.join('\n') + '\n', 'utf8')
  console.log(`\n[${mode}] ${lines.length} 行を ${out} に録った`)
}

async function main(): Promise<void> {
  const bin = await locateClaude()
  const env = await loginShellEnv()

  // 引数で片方だけ録れる。既定は両方。
  const only = process.argv[2]?.replace(/^--/, '') as Mode | undefined
  const modes: Mode[] = only === 'safe' || only === 'full' ? [only] : ['safe', 'full']

  for (const mode of modes) await record(mode, bin, env)

  console.log('\nsession_id・cwd・uuid など環境依存の値が入る。commit 前に一度目で見ること。')
  console.log('session-full.ndjson は gitignore 済み(過去セッションの要約が入るため)。')
  process.exit(0)
}

main().catch((err) => {
  console.error(String(err))
  process.exit(1)
})
