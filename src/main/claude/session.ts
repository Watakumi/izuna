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
  type SDKMessageOrigin,
  type SlashCommand,
  type SettingSource,
  type McpServerConfig,
  type HookEvent,
  type HookCallbackMatcher
} from '@anthropic-ai/claude-agent-sdk'
import { settle } from '../../shared/wait'
import type { Attachment } from '../../shared/image'
import { locateClaude, refreshLoginShellEnv } from './locate'
import { withoutBillingKeys } from '../../shared/billing'

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
  /**
   * サブエージェント（実行役）からの要求ならその id。ブレイン本体なら undefined。
   *
   * **これがあっても人間に上げる。** 承認をブレインに渡さないのは
   * 設計判断であって、機構の都合ではない（docs/GOAL.md 完成の定義 5）。
   */
  agentId?: string
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
  /** 作業ディレクトリの外で読み書きさせたい場所。共有フォルダ（§12）を渡す */
  additionalDirectories?: string[]
  /** 既定のシステムプロンプトに足す申し送り */
  appendSystemPrompt?: string
  /**
   * プロセス内の MCP サーバ。自律ループの `izuna_progress` を渡すのに使う。
   *
   * **別プロセスを建てない。** SDK が `createSdkMcpServer` を持っているので、
   * ここに渡すだけで済む（Nimbalyst は同じことに 752 行使っていた）。
   */
  mcpServers?: Record<string, McpServerConfig>
  /**
   * プロセス内の hook。実行役の節目（`SubagentStop` / `TeammateIdle` …）を拾うのに使う（§12）。
   * リポジトリの `.claude/settings.json` の hook とは別で、こちらは関所（§26）を通らない ——
   * Izuna 自身が張るものだから。
   */
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>
}

type Events = {
  message: [SDKMessage]
  permission: [PermissionRequest]
  /** 誰も答えないまま期限が来た承認要求。画面から消すために使う */
  permissionExpired: [string]
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
    // **ここで取り直す。** 人が rc を直すのは、新しいセッションを起こす前である
    const [pathToClaudeCodeExecutable, shellEnv] = await Promise.all([
      locateClaude(),
      refreshLoginShellEnv()
    ])
    // **鍵は渡さない。** 拾うと従量課金に切り替わる（`shared/billing.ts`）
    const { env, removed } = withoutBillingKeys(shellEnv)
    if (removed.length > 0) console.warn(`[izuna] 環境の ${removed.join(', ')} は claude に渡しません（課金の経路を変えないため）`)

    this.#query = query({
      prompt: this.#input,
      options: {
        cwd: this.options.cwd,
        model: this.options.model,
        permissionMode: this.options.permissionMode,
        resume: this.options.resume,
        forkSession: this.options.forkSession,
        // **省略すると Claude Code の既定プロンプトが一切入らない。**
        // 作業ディレクトリも auto-memory も git status も振る舞いの指示も
        // 無い状態になり、エージェントは自分がどこにいるか知らないまま
        // それらしいパスを作り話する（実測 2026-09-07）。
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          ...(this.options.appendSystemPrompt ? { append: this.options.appendSystemPrompt } : {})
        },
        additionalDirectories: this.options.additionalDirectories,
        includePartialMessages: true,
        // 実行役の発話も流す。既定では tool_use / tool_result しか来ないので、
        // 何を考えて何をしたのかが見えない（段4）
        forwardSubagentText: true,
        settingSources: this.options.settingSources,
        ...(this.options.mcpServers ? { mcpServers: this.options.mcpServers } : {}),
        ...(this.options.hooks ? { hooks: this.options.hooks } : {}),
        pathToClaudeCodeExecutable,
        env: env as Record<string, string>,
        canUseTool: (toolName, input, opts) => this.#ask(toolName, input, opts)
      }
    })

    this.#running = true
    void this.#consume()
  }

  /**
   * 1 ターン進める。スラッシュコマンドも `/foo args` として渡す。
   *
   * **出どころを偽らない。** 既定は人の打鍵だが、起床の予約や自律ループが
   * 送るものは人が打っていない。そこを `human` にすると、CLI の
   * 「人が言った」を根拠にする判断が全部その前提で動く（§26）。
   */
  send(text: string, images: Attachment[] = [], origin: SDKMessageOrigin = { kind: 'human' }): void {
    if (!this.#running) throw new Error('セッションが起動していません')
    // 画像を先に置く。**後ろに置くと、指示より前に見てもらえない** ——
    // 「この画面のここ」のような指示は、画像を見た後でしか意味を持たない
    const content = [
      ...images.map((a) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: a.mediaType, data: a.data }
      })),
      { type: 'text' as const, text }
    ]
    this.#input.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: this.#sessionId ?? '',
      // 省略すると出所不明として扱われる。人の打鍵なら明示して human
      origin
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

  /**
   * 権限モードを変える。ストリーミング入力モードでのみ効く（Izuna は該当）。
   *
   * 段4 で効いてくる注意: **モードのクラスは他セッションからの
   * SendMessage の配送可否を決める**（CLAUDE.md §12）。ブレインと実行役で
   * bypass / prompting が食い違うと、指示が黙って保留される。
   */
  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.#query?.setPermissionMode(mode)
  }

  /** モデルを変える。undefined で既定に戻す */
  async setModel(model?: string): Promise<void> {
    await this.#query?.setModel(model)
  }

  /** 生成中のターンを止める。会話は生かしたまま */
  async interrupt(): Promise<void> {
    await this.#query?.interrupt()
  }

  /**
   * 承認を待つ上限。**答えが来なければ deny する。**
   *
   * §6 に「答えないまま放置すると CLI は待ち続ける」と書きながら、
   * 上限を置いていなかった。人が画面を見ているうちは露呈しないが、
   * **無人で回した瞬間に固まる**。
   *
   * Nimbalyst は同じ場所を 5 分で deny していた（実測。外部 CLI 経路は 10 分）。
   * 同じ値を採る —— 短すぎると考えている人を追い出し、
   * 長すぎると止まったことに気づけない。
   */
  static readonly PERMISSION_TIMEOUT_MS = 5 * 60_000

  async stop(): Promise<void> {
    this.#input.close()
    this.#running = false
    // 未応答の承認を fail-closed で畳む。放置すると CLI が待ち続ける
    for (const [, resolve] of this.#pending) {
      resolve({ behavior: 'deny', message: 'セッションが終了しました' })
    }
    this.#pending.clear()
    // 返らないことがある。片付けのために終了できなくなるのは本末転倒なので、
    // 上限を切って諦める（shared/wait.ts の註）
    const query = this.#query
    this.#query = undefined
    if (query) await settle(Promise.resolve(query.return(undefined)), 2000)
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
      agentID?: string
      title?: string
      description?: string
      blockedPath?: string
      decisionReason?: unknown
    }
  ): Promise<PermissionResult> {
    const id = randomUUID()
    return new Promise<PermissionResult>((resolve) => {
      this.#pending.set(id, resolve)

      /**
       * **「人が拒否した」と「誰も答えなかった」を区別する。**
       * 同じ deny でも、エージェントが次に取るべき手が違う ——
       * 前者はやり方を変えるべきで、後者は人を呼ぶべきである。
       */
      const timer = setTimeout(() => {
        if (!this.#pending.delete(id)) return
        this.emit('permissionExpired', id)
        resolve({
          behavior: 'deny',
          message: `${ClaudeSession.PERMISSION_TIMEOUT_MS / 60_000} 分待ちましたが、誰も答えませんでした（拒否されたわけではありません）`
        })
      }, ClaudeSession.PERMISSION_TIMEOUT_MS)

      const settle = (result: PermissionResult): void => {
        clearTimeout(timer)
        resolve(result)
      }
      this.#pending.set(id, settle)

      // 中断されたら fail-closed。答えないまま放置すると CLI が待ち続ける。
      opts.signal?.addEventListener('abort', () => {
        if (!this.#pending.delete(id)) return
        settle({ behavior: 'deny', message: '承認要求が取り消されました' })
      })

      this.emit('permission', {
        id,
        toolName,
        input,
        toolUseId: opts.toolUseID,
        agentId: opts.agentID,
        suggestions: opts.suggestions,
        title: opts.title,
        description: opts.description,
        blockedPath: opts.blockedPath,
        decisionReason: opts.decisionReason
      })
    })
  }
}
