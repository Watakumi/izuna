import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type {
  HookInput,
  HookJSONOutput,
  PermissionMode,
  PermissionResult,
  SDKMessage,
  SlashCommand
} from '@anthropic-ai/claude-agent-sdk'
import { settle } from '../shared/wait'
import { canDraft, draftPrompt } from '../shared/commit'
import { canReview, reviewPrompt } from '../shared/review'
import type { TaskStatus } from '../shared/team'
import type { Attachment } from '../shared/image'
import type { Progress } from '../shared/loop'
import type { Wakeup } from '../shared/wakeup'
import { TEAMMATE_HOOKS, logEntryOf, teammateEventOf, type TeammateHooks } from '../shared/teammate'
import type { SessionEvent, SessionId, StartSessionInput } from '../shared/ipc'
import { ClaudeSession } from './claude/session'
import { gateProjectHooks } from './claude/trust'
import {
  appendLog,
  ensureTeam,
  readBoard,
  setTaskStatus,
  teamInstructions,
  type TeamBoard
} from './team'
import { progressServer, readProgress, runLoop, type RunningLoop } from './loop'
import { Wakeups } from './wakeup'
import { commitContext, currentBranch } from './git/remote'

/**
 * 走っているセッションと、それに紐づくもの（共有フォルダ・作業ディレクトリ・ループ）。
 *
 * **1 件 1 record。** 以前は `register.ts` に同じ id で引く Map が 4 本あり、
 * 片方だけ消して片方が残る形だった。しかも `register.ts` は「登録だけ」の建前で
 * 検査から外れていたので、ループの駆動と起床の配送は誰も検査していなかった（§28）。
 */
interface Record {
  session: ClaudeSession
  team: string
  cwd: string
  loop: RunningLoop | null
}

/**
 * セッションの駆動部。ipcMain を知らない。
 *
 * `register.ts` はここへの橋渡しだけをする。UI へ流すものは `emit` で受け取る。
 */
export class SessionHub {
  readonly #records = new Map<SessionId, Record>()
  /** 人に見せる名前。**終わっても消さない** —— exit の通知は記録が消えたあとに出る */
  readonly #labels = new Map<SessionId, string>()
  readonly #wakeups: Wakeups
  readonly #emit: (event: SessionEvent) => void

  constructor(emit: (event: SessionEvent) => void, wakeups = new Wakeups()) {
    this.#emit = emit
    this.#wakeups = wakeups
    /**
     * 時が来たら、そのセッションに送る。
     *
     * **もう無いセッションには送らない。** アプリを閉じたあとの予約は
     * `overdue` として残り、人が改めて起こす（§23）。
     */
    wakeups.onFire((w) => {
      const r = this.#records.get(w.sessionId)
      if (!r) return
      // 予約した時刻に届いたもの。人がいま打ったのではない
      r.session.send(w.prompt, [], { kind: 'task-notification', subkind: 'scheduled-trigger' })
      this.#emit({ kind: 'wokeUp', id: w.sessionId, prompt: w.prompt })
    })
  }

  /** 起動時に 1 回。予約を読んでタイマーを張る */
  async open(): Promise<void> {
    await this.#wakeups.start()
  }

  /** 通知に出す名前。作業ディレクトリの末尾。知らない id は id の頭 */
  labelOf(id: SessionId): string {
    return this.#labels.get(id) ?? id.slice(0, 8)
  }

  #must(id: SessionId): Record {
    const r = this.#records.get(id)
    if (!r) throw new Error(`セッションが見つかりません: ${id}`)
    return r
  }

  async start(input: StartSessionInput): Promise<SessionId> {
    const id = randomUUID()
    // **開く前に、そのリポジトリが持ち込む hook を見る**（§26）。
    // 信頼していない場所に hook があれば、ここで止まる
    const settingSources = await gateProjectHooks(input.cwd)
    // 共有フォルダを先に用意する。場所を教えるだけでは使われないので、
    // 規律ごと申し送りに書いて渡す（§12）
    const team = await ensureTeam(input.team ?? 'default')
    const session = new ClaudeSession({
      cwd: input.cwd,
      model: input.model,
      permissionMode: input.permissionMode,
      resume: input.resume,
      // 既定は project + local（`shared/config.ts`）。利用者の端末のプラグイン
      // hook を引き継がない（CLAUDE.md §7）。'project' は残す ——
      // 外すとプロジェクトの CLAUDE.md が読まれなくなる。
      settingSources,
      additionalDirectories: [team],
      appendSystemPrompt: teamInstructions(team),
      // 自律ループが進捗を申告するための口。**ループでなくても渡してよい**
      // （呼ばれなければ何も起きない）
      mcpServers: { izuna: progressServer(team) },
      hooks: this.#teammateHooks(id, team)
    })

    session.on('message', (message) => this.#emit({ kind: 'message', id, message }))
    session.on('permission', (request) => this.#emit({ kind: 'permission', id, request }))
    session.on('permissionExpired', (requestId) =>
      this.#emit({ kind: 'permissionExpired', id, requestId })
    )
    session.on('error', (err) => this.#emit({ kind: 'error', id, message: err.message }))
    session.on('done', () => {
      void appendLog(team, {
        at: new Date().toISOString(),
        from: 'izuna',
        to: 'brain',
        kind: 'end',
        target: input.cwd,
        note: '終了'
      })
      // ループはセッションと運命を共にする。取り残すと、無いセッションに送り続ける
      this.#records.get(id)?.loop?.stop()
      this.#records.delete(id)
      this.#emit({ kind: 'exit', id })
    })

    // log.md は Izuna が書く（§16）。追記のみ。**エージェントには書かせない**
    void appendLog(team, {
      at: new Date().toISOString(),
      from: 'izuna',
      to: 'brain',
      kind: 'start',
      target: input.cwd,
      note: input.resume ? '続きから' : '新規'
    })

    this.#records.set(id, { session, team, cwd: input.cwd, loop: null })
    this.#labels.set(id, basename(input.cwd) || input.cwd)
    try {
      await session.start()
    } catch (err) {
      this.#records.delete(id)
      throw err
    }
    return id
  }

  /**
   * 実行役の節目を拾う hook（§12「反省ループの起点は hook」）。
   *
   * 拾ったら `log.md` に書き（Izuna が書く。§12）、画面に流す。
   * **止めない。** 返すのは空で、`continue: false` も `decision` も付けない ——
   * 実行役を止めるのはブレインの判断で、Izuna が hook で割り込むものではない。
   */
  #teammateHooks(id: SessionId, team: string): TeammateHooks {
    const record = async (input: HookInput): Promise<HookJSONOutput> => {
      const event = teammateEventOf(input)
      if (event) {
        await appendLog(team, logEntryOf(event))
        this.#emit({ kind: 'teammate', id, event })
      }
      return {}
    }
    return Object.fromEntries(TEAMMATE_HOOKS.map((name) => [name, [{ hooks: [record] }]]))
  }

  send(id: SessionId, text: string, images: Attachment[] = []): void {
    this.#must(id).session.send(text, images)
  }

  slashCommands(id: SessionId): Promise<SlashCommand[]> {
    return this.#must(id).session.slashCommands()
  }

  interrupt(id: SessionId): Promise<void> {
    return this.#must(id).session.interrupt()
  }

  setPermissionMode(id: SessionId, mode: PermissionMode): Promise<void> {
    return this.#must(id).session.setPermissionMode(mode)
  }

  setModel(id: SessionId, model?: string): Promise<void> {
    return this.#must(id).session.setModel(model)
  }

  respondPermission(id: SessionId, requestId: string, result: PermissionResult): void {
    this.#must(id).session.respondToPermission(requestId, result)
  }

  async stop(id: SessionId): Promise<void> {
    const r = this.#records.get(id)
    if (!r) return
    r.loop?.stop()
    this.#records.delete(id)
    await r.session.stop()
  }

  /**
   * アプリ終了時に取り残さない。放置すると claude が孤児プロセスになる。
   *
   * **必ず返る。** 後片付けが終わらないせいでアプリが終了できない、という
   * 事態を作らない（実際にやらかして Ctrl+C が効かなくなった）。
   * 上限を過ぎたら諦めて先へ進む —— 孤児が 1 つ残るほうが、
   * 終われないアプリよりましである。
   */
  async stopAll(timeoutMs = 3000): Promise<void> {
    const all = [...this.#records.values()]
    this.#records.clear()
    for (const r of all) r.loop?.stop()
    if (all.length === 0) return
    await settle(Promise.all(all.map((r) => r.session.stop())), timeoutMs)
  }

  // ── 共有フォルダ（§16）────────────────────────────────────

  /** 盤面は読むだけ。**壊れた札も落とさずに返す**（黙って消すと書いた本人が気づけない） */
  async teamBoard(id: SessionId): Promise<TeamBoard | null> {
    const r = this.#records.get(id)
    return r ? await readBoard(r.team) : null
  }

  async setTaskStatus(id: SessionId, taskId: string, status: TaskStatus): Promise<boolean> {
    const r = this.#records.get(id)
    if (!r) return false
    const ok = await setTaskStatus(r.team, taskId, status)
    if (ok)
      await appendLog(r.team, {
        at: new Date().toISOString(),
        from: 'izuna',
        to: 'board',
        kind: 'status',
        target: taskId,
        note: status
      })
    return ok
  }

  // ── 自律ループ（§23）──────────────────────────────────────

  /** **画面にはファイルの場所を持たせない。** セッションから引く */
  loopProgress(id: SessionId): Promise<Progress> {
    return readProgress(this.#records.get(id)?.team ?? '')
  }

  stopLoop(id: SessionId): void {
    const r = this.#records.get(id)
    if (!r) return
    r.loop?.stop()
    r.loop = null
  }

  startLoop(id: SessionId, maxIterations: number): void {
    const r = this.#must(id)
    if (r.loop) throw new Error('このセッションでは既にループが回っています')

    /**
     * **1 反復 = 1 ターン。** 文脈を捨てるのは CLI 側の仕事ではないので、
     * ここでは「送って、結果が返るまで待つ」だけにする。
     * 引き継ぎは `progress.json` に入っている（`shared/loop.ts` の註）。
     */
    const runIteration = (prompt: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const onMessage = (m: SDKMessage): void => {
          if (m.type !== 'result') return
          cleanup()
          resolve()
        }
        const onError = (err: Error): void => {
          cleanup()
          reject(err)
        }
        const cleanup = (): void => {
          r.session.off('message', onMessage)
          r.session.off('error', onError)
        }
        r.session.on('message', onMessage)
        r.session.on('error', onError)
        // 人が打ったのではない。ループが続けている
        r.session.send(prompt, [], { kind: 'auto-continuation' })
      })

    const loop = runLoop({
      teamDir: r.team,
      maxIterations,
      runIteration,
      onProgress: (progress, iteration) =>
        this.#emit({ kind: 'loopProgress', id, progress, iteration })
    })
    r.loop = loop
    void loop.done.then((stop) => {
      if (r.loop === loop) r.loop = null
      this.#emit({ kind: 'loopStopped', id, stop })
    })
  }

  // ── 起床の予約 ────────────────────────────────────────────

  listWakeups(): Promise<Wakeup[]> {
    return this.#wakeups.list()
  }

  removeWakeup(wakeupId: string): Promise<void> {
    return this.#wakeups.remove(wakeupId)
  }

  async fireWakeup(wakeupId: string): Promise<void> {
    await this.#wakeups.fireNow(wakeupId)
  }

  addWakeup(id: SessionId, minutes: number, prompt: string): Promise<Wakeup> {
    return this.#wakeups.add({
      sessionId: id,
      cwd: this.#records.get(id)?.cwd ?? '',
      prompt,
      fireAt: Date.now() + minutes * 60_000
    })
  }

  // ── 会話に頼むもの ────────────────────────────────────────

  /** コミット文の下書き。**会話に流す** —— 別のセッションを起こすと、この作業の文脈が使えない */
  async draftCommitMessage(id: SessionId): Promise<void> {
    const r = this.#must(id)
    const context = await commitContext(r.cwd)
    if (!canDraft(context)) throw new Error('コミットする変更がありません')
    r.session.send(draftPrompt(context))
  }

  /** 差分のレビュー。**差分は渡さない** —— エージェントは同じ作業ディレクトリで git を持っている */
  async requestReview(id: SessionId, base: string, pull?: number): Promise<void> {
    const r = this.#must(id)
    const head = await currentBranch(r.cwd)
    const context = { head, base, pull: pull ?? null }
    if (!canReview(context)) throw new Error('何と比べるかが決まりません')
    r.session.send(reviewPrompt(context))
  }
}
