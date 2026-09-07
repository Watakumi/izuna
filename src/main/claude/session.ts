import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type PermissionResult,
  type PermissionMode,
  type PermissionUpdate,
  type SlashCommand,
  type SettingSource
} from '@anthropic-ai/claude-agent-sdk'
import { locateClaude, loginShellEnv } from './locate'

/**
 * claude との 1 会話。
 *
 * 生の NDJSON を自前で読むのはやめ、`@anthropic-ai/claude-agent-sdk` に委ねている。
 * 理由は権限承認で、CLI は「SDK ホストとして名乗った相手」にしか
 * `can_use_tool` を投げない。名乗りは control protocol の往復で、
 * 手で実装すると 8,800 行の型付きプロトコルを自前で追い続けることになる。
 * 詳細は CLAUDE.md §6。
 *
 * このクラスは UI を知らない。UI は `permission` を受けて
 * `respondToPermission()` を呼び返すだけでよい。
 */

/** 承認を求められている 1 件。UI はこれを描いて答えを返す */
export interface PermissionRequest {
  /** 応答を突き合わせるための id。UI はこれをそのまま返す */
  id: string
  toolName: string
  input: Record<string, unknown>
  toolUseId?: string
  /** CLI が用意した「次はこう許可すると楽」の候補。常に許可ボタンの中身になる */
  suggestions?: PermissionUpdate[]
  title?: string
  description?: string
  /** 拒否の理由がすでに決まっている場合（サンドボックス外のパスなど） */
  blockedPath?: string
  decisionReason?: unknown
}

export interface SessionOptions {
  cwd: string
  model?: string
  permissionMode?: PermissionMode
  /** 既存セッションの続き */
  resume?: string
  /** resume しつつ別セッションとして枝分かれさせる */
  forkSession?: boolean
  /**
   * 読み込む設定の出どころ。省略すると CLI と同じで全部読む。
   *
   * `[]` は SDK の隔離モード。`~/.claude/settings.json` を読まなくなるので、
   * そこに書かれた `enabledPlugins` 経由の hook も落ちる（§7 の罠の対処）。
   * ただし `'project'` を外すと CLAUDE.md も読まれなくなる点に注意。
   */
  settingSources?: SettingSource[]
}

type Events = {
  message: [SDKMessage]
  permission: [PermissionRequest]
  error: [Error]
  done: []
}

/** 押し込み式の非同期キュー。SDK は入力を AsyncIterable で受け取る */
class InputQueue {
  private readonly queued: SDKUserMessage[] = []
  private waiting?: (m: IteratorResult<SDKUserMessage>) => void
  private closed = false

  push(message: SDKUserMessage): void {
    if (this.closed) return
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = undefined
      resolve({ value: message, done: false })
    } else {
      this.queued.push(message)
    }
  }

  close(): void {
    this.closed = true
    this.waiting?.({ value: undefined, done: true })
    this.waiting = undefined
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      const next = this.queued.shift()
      if (next) {
        yield next
        continue
      }
      if (this.closed) return
      const result = await new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
        this.waiting = resolve
      })
      if (result.done) return
      yield result.value
    }
  }
}

export class ClaudeSession extends EventEmitter<Events> {
  #query?: Query
  #input = new InputQueue()
  #sessionId?: string
  #pending = new Map<string, (result: PermissionResult) => void>()
  #running = false

  constructor(private readonly options: SessionOptions) {
    super()
  }

  get sessionId(): string | undefined {
    return this.#sessionId
  }

  get running(): boolean {
    return this.#running
  }

  async start(): Promise<void> {
    if (this.#query) throw new Error('セッションは既に起動しています')

    // Finder 起動の Electron は PATH を継承しない。ログインシェルから解く。
    // env を渡しても keychain 経由の OAuth はそのまま効く（API キーには落ちない）。
    const [pathToClaudeCodeExecutable, env] = await Promise.all([
      locateClaude(),
      loginShellEnv()
    ])

    this.#query = query({
      prompt: this.#input,
      options: {
        cwd: this.options.cwd,
        model: this.options.model,
        permissionMode: this.options.permissionMode,
        resume: this.options.resume,
        forkSession: this.options.forkSession,
        includePartialMessages: true,
        settingSources: this.options.settingSources,
        pathToClaudeCodeExecutable,
        env: env as Record<string, string>,
        canUseTool: (toolName, input, opts) => this.#ask(toolName, input, opts)
      }
    })

    this.#running = true
    void this.#consume()
  }

  /** 1 ターン進める。スラッシュコマンドも `/foo args` として渡す */
  send(text: string): void {
    if (!this.#running) throw new Error('セッションが起動していません')
    this.#input.push({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
      session_id: this.#sessionId ?? '',
      // 人間の打鍵であることを明示する。省略すると出所不明として扱われる
      origin: { kind: 'human' }
    } as SDKUserMessage)
  }

  /** UI からの承認結果を CLI に返す */
  respondToPermission(id: string, result: PermissionResult): void {
    const resolve = this.#pending.get(id)
    if (!resolve) return
    this.#pending.delete(id)
    resolve(result)
  }

  /** `/` パレットの材料。CLI が解決済みの一覧を返す */
  async slashCommands(): Promise<SlashCommand[]> {
    if (!this.#query) return []
    return await this.#query.supportedCommands()
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.#query?.setPermissionMode(mode)
  }

  /** 生成中のターンを止める。会話は生かしたまま */
  async interrupt(): Promise<void> {
    await this.#query?.interrupt()
  }

  async stop(): Promise<void> {
    this.#input.close()
    this.#running = false
    // 未応答の承認を fail-closed で畳む。放置すると CLI が待ち続ける
    for (const [, resolve] of this.#pending) {
      resolve({ behavior: 'deny', message: 'セッションが終了しました' })
    }
    this.#pending.clear()
    await this.#query?.return(undefined)
    this.#query = undefined
  }

  async #consume(): Promise<void> {
    try {
      for await (const message of this.#query!) {
        if (message.type === 'system' && message.subtype === 'init') {
          this.#sessionId = message.session_id
        }
        this.emit('message', message)
      }
      this.emit('done')
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    } finally {
      this.#running = false
    }
  }

  #ask(
    toolName: string,
    input: Record<string, unknown>,
    opts: {
      signal?: AbortSignal
      suggestions?: PermissionUpdate[]
      toolUseID?: string
      title?: string
      description?: string
      blockedPath?: string
      decisionReason?: unknown
    }
  ): Promise<PermissionResult> {
    const id = randomUUID()
    return new Promise<PermissionResult>((resolve) => {
      this.#pending.set(id, resolve)

      // 中断されたら fail-closed。答えないまま放置すると CLI が待ち続ける。
      opts.signal?.addEventListener('abort', () => {
        if (!this.#pending.delete(id)) return
        resolve({ behavior: 'deny', message: '承認要求が取り消されました' })
      })

      this.emit('permission', {
        id,
        toolName,
        input,
        toolUseId: opts.toolUseID,
        suggestions: opts.suggestions,
        title: opts.title,
        description: opts.description,
        blockedPath: opts.blockedPath,
        decisionReason: opts.decisionReason
      })
    })
  }
}
