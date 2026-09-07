import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { EventEmitter } from 'node:events'
import type { ClaudeEvent, InitEvent } from '../../shared/protocol'
import { isInit, userInput } from '../../shared/protocol'
import { locateClaude, loginShellEnv } from './locate'

export interface SessionOptions {
  /** 作業ディレクトリ。claude はここを基準に CLAUDE.md と .claude/ を解決する */
  cwd: string
  model?: string
  permissionMode?: InitEvent['permissionMode']
  /** 既存セッションの続き。system:init の session_id を渡す */
  resumeSessionId?: string
  /** 明示的に実行ファイルを指定したいとき */
  claudePath?: string
}

type Events = {
  event: [ClaudeEvent]
  init: [InitEvent]
  stderr: [string]
  exit: [{ code: number | null; signal: NodeJS.Signals | null }]
  error: [Error]
}

/**
 * claude CLI を stream-json の双方向モードで飼う。
 *
 * 1プロセス = 1会話。プロセスは turn をまたいで生き続け、stdin に1行流すと
 * 1ターン進む。stdout は NDJSON で、1行が1イベント。
 */
export class ClaudeSession extends EventEmitter<Events> {
  private child?: ChildProcessWithoutNullStreams
  private reader?: Interface
  #sessionId?: string
  #init?: InitEvent

  constructor(private readonly options: SessionOptions) {
    super()
  }

  get sessionId(): string | undefined {
    return this.#sessionId
  }

  /** system:init の中身。/ コマンド一覧・モデル・スキルはここから取る */
  get init(): InitEvent | undefined {
    return this.#init
  }

  get running(): boolean {
    return this.child !== undefined && this.child.exitCode === null
  }

  async start(): Promise<void> {
    if (this.child) throw new Error('セッションは既に起動しています')

    const bin = this.options.claudePath ?? (await locateClaude())
    const env = await loginShellEnv()

    const args = [
      '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      // -p と stream-json の組み合わせでは verbose がないとイベントが落ちる
      '--verbose',
      // 逐次描画のための差分イベント
      '--include-partial-messages',
      // 送った user メッセージを stdout に echo させ、送達確認に使う
      '--replay-user-messages',
      // 権限プロンプトはこのアプリが答える
      '--permission-prompts', 'host'
    ]
    if (this.options.model) args.push('--model', this.options.model)
    if (this.options.permissionMode) args.push('--permission-mode', this.options.permissionMode)
    if (this.options.resumeSessionId) args.push('--resume', this.options.resumeSessionId)

    const child = spawn(bin, args, {
      cwd: this.options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    }) as ChildProcessWithoutNullStreams
    this.child = child

    child.on('error', (err) => this.emit('error', err))
    child.on('exit', (code, signal) => {
      this.reader?.close()
      this.emit('exit', { code, signal })
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => this.emit('stderr', chunk))

    child.stdout.setEncoding('utf8')
    this.reader = createInterface({ input: child.stdout, crlfDelay: Infinity })
    this.reader.on('line', (line) => this.onLine(line))
  }

  /** 1ターン進める。スラッシュコマンドもここに `/foo args` として渡す */
  send(text: string): void {
    if (!this.child?.stdin.writable) throw new Error('セッションが起動していません')
    this.child.stdin.write(JSON.stringify(userInput(text)) + '\n')
  }

  /** 生成中のターンを止める。プロセスは生かしたまま */
  interrupt(): void {
    this.child?.kill('SIGINT')
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    child.stdin.end()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.child = undefined
  }

  private onLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let parsed: ClaudeEvent
    try {
      parsed = JSON.parse(trimmed) as ClaudeEvent
    } catch {
      // NDJSON に混ざった非 JSON は、CLI の警告など診断情報であることが多い。
      // 握りつぶさず stderr 相当として上げる。
      this.emit('stderr', trimmed + '\n')
      return
    }

    if (isInit(parsed)) {
      this.#init = parsed
      this.#sessionId = parsed.session_id
      this.emit('init', parsed)
    } else if (typeof (parsed as { session_id?: string }).session_id === 'string') {
      this.#sessionId ??= (parsed as { session_id: string }).session_id
    }

    this.emit('event', parsed)
  }
}
