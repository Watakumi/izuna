import { appendFile, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  createSdkMcpServer,
  tool,
  type HookInput,
  type HookJSONOutput,
  type SDKMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import {
  DEFAULT_ROLES,
  neutralize,
  MAX_TURNS,
  PAST_MINUTES,
  deltaFor,
  formatEntry,
  formatMinutes,
  meetingIdFor,
  moderatorPrompt,
  openingPrompt,
  outsideScope,
  parseMeta,
  parseRole,
  parseTranscript,
  personaPrompt,
  serializeRole,
  type Entry,
  type MeetingMeta,
  type MeetingEvent,
  type MeetingSummary,
  type MeetingView,
  type Minutes,
  type Role
} from '../shared/meeting'
import type { SessionEvent } from '../shared/ipc'
import { settle } from '../shared/wait'
import { ClaudeSession } from './claude/session'
import { gateProjectHooks } from './claude/trust'
import { loadConfig } from './config'
import { exists, writeAtomic } from './fsx'

/**
 * 会議の駆動部（§39）。判断の材料は `shared/meeting.ts`（純粋関数）が持つ。
 *
 * **会議は司会の 1 ターンに収まる。** 司会が `izuna_next` で指名すると、その手は
 * **参加者が話し終わるまで返らず**、発言をツールの結果として返す。すぐ返すと、司会は
 * 1 ターンで指名を 6 回続けて、発言を一度も読まずに閉会した（2026-10-06 に測った）。
 *
 * **文脈は 2 段で残す。**
 * - 参加者は `(リポジトリ, 役)` ごとに claude のセッションを 1 本持ち、会議を跨いで resume する
 *   （`members.json`）。前の会議で何を言ったかを本人が覚えている（同日に測った）
 * - 議事録はファイルに残し、次の会議の司会に添える。圧縮を跨いで残るのはこちら（§12 と同じ理屈）
 *
 * **書き手は Izuna だけ。** 発言録・議事録・控えのどれも、エージェントには書かせない。
 * 参加者の道具は Read / Glob / Grep だけで、承認が来たら断る —— 会議では手を動かさない。
 */

export const MEETINGS_BASE = join(homedir(), '.izuna', 'meetings')
export const ROLES_DIR = join(homedir(), '.izuna', 'roles')

/** 参加者に渡す道具。読むだけ */
const READ_ONLY = ['Read', 'Glob', 'Grep']
const NEXT = 'mcp__izuna__izuna_next'
const CLOSE = 'mcp__izuna__izuna_close'

/**
 * 参加者に渡す文の出どころ。**`human` と偽らない**（§26）—— 中身は人の発言と
 * 他の参加者の発言の中継で、人がいま打ったものではない。`peer` でも保留されずに届く
 * （2026-10-06 に測った。同じ権限モードのクラスなので `crossSessionInbound` の保留は起きない）。
 */
const RELAYED: SDKUserMessage['origin'] = {
  kind: 'peer',
  from: 'izuna-meeting',
  fromMode: 'prompting',
  name: '会議'
}

const writeJson = (path: string, value: unknown): Promise<void> =>
  writeAtomic(path, JSON.stringify(value, null, 2))

/**
 * 会議のセッションに共通の設定。**`strictMcpConfig` を必ず付ける** —— 付けないと、Izuna が
 * 利用者の設定を読まなくても claude.ai のコネクタ（Gmail の送信、Slack の送信、Asana の削除…）と
 * リポジトリの `.mcp.json` の口が参加者に見えていた（2026-10-07 に測った。付けると 0 本）。
 * 権限モードも `default` を明示し、リポジトリの設定の `defaultMode` に左右されないようにする
 */
const LOCKED = { strictMcpConfig: true, permissionMode: 'default' } as const

/**
 * 役を読む。**置き場が無いときだけ**同梱の役を書き出す（`DEFAULT_ROLES` の註）。
 * 読めないファイルは `broken` に名指しで返す。黙って捨てない。
 */
export async function loadRoles(dir: string): Promise<{ roles: Role[]; broken: string[] }> {
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true })
    for (const r of DEFAULT_ROLES)
      await writeFile(join(dir, `${r.name}.md`), serializeRole(r), 'utf8')
  }
  const roles: Role[] = []
  const broken: string[] = []
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()) {
    const role = parseRole(file.slice(0, -3), await readFile(join(dir, file), 'utf8'))
    if (role) roles.push(role)
    else broken.push(file)
  }
  return { roles, broken }
}

/**
 * 仕事を 1 本ずつ通す。**前が失敗しても次は走る**し、失敗はその仕事を待っている呼び手に届く。
 * 鎖の後ろは必ず成功で終わる約束だけを持つので、途中で例外を握る必要が無い。
 */
type Lane = <T>(job: () => Promise<T>) => Promise<T>

function lane(): Lane {
  let tail: Promise<void> = Promise.resolve()
  return (job) => {
    const prev = tail
    let release = (): void => {}
    tail = new Promise<void>((r) => (release = r))
    return prev.then(job).finally(release)
  }
}

/**
 * 1 回の会議の走り。**起こした瞬間に載せ、片付けが終わるまで外さない。**
 *
 * 2 回目のレビューまでは「止めたら外す」「起こしている途中は別の印」で直していたが、待つ場所が
 * 増えるたびに確かめ忘れが出た（止めたあとに偽の発言を書く、2 つの回が重なる、終了時に司会が残る）。
 * いまは回が 1 つの会議に 1 つだけ載り、止められた回は**何も書かない**。止めたあとに人が話した分は、
 * その回の片付けが終わってから次の回で渡す（`again`）。
 */
class Run {
  meta!: MeetingMeta
  roles: Role[] = []
  entries: Entry[] = []
  /** 発言録を読み終えたか。読む前に人が話した分はファイルにだけ書く（読むときに載る） */
  loaded = false
  settingSources: Awaited<ReturnType<typeof gateProjectHooks>> = []
  mask = true
  /** 参加者が読める会議のフォルダ。**同じリポジトリのものだけ** */
  readable: string[] = []
  moderator: ClaudeSession | null = null
  members = new Map<string, ClaudeSession>()
  /** 司会がどこまで聞いたか（発言録の位置）。ここから後の人の発言を、次に司会へ渡す */
  modSeen = 0
  /** この回を起こした時点の発言録の長さ。ここより前は、この回が渡そうとして失敗したもの */
  began = 0
  spoken = 0
  closeRequested = false
  /** 人が止めた。以後この回は何も書かず、誰も起こさない */
  stopped = false
  /** 止めたあとに人が話した。片付けが終わったら次の回を起こす */
  again = false
  /** この回が「使用中」にした参加者の覚え。片付けで全部外す（始まる前に失敗した分も） */
  readonly claimed = new Set<string>()
  /** 指名と閉会は 1 つずつ。司会が同時に 2 つ呼んでも、順に処理する */
  readonly queue = lane()
  done: Promise<void> = Promise.resolve()

  constructor(
    readonly id: string,
    readonly dir: string
  ) {}

  /** 止められていたら投げる。待つたびに呼ぶ */
  halt(): void {
    if (this.stopped) throw new Error('会議は止められました')
  }
}

/**
 * 1 ターン分を送り、`result` が来るまで待つ。返すのは本人の発言だけ ——
 * サブエージェントの発話は混ぜない（`parent_tool_use_id` が付く）。
 */
function turnOf(
  session: ClaudeSession,
  text: string,
  origin: SDKUserMessage['origin']
): Promise<string> {
  return new Promise((resolve, reject) => {
    const out: string[] = []
    const cleanup = (): void => {
      session.off('message', onMessage)
      session.off('error', onError)
      session.off('done', onDone)
    }
    const onMessage = (m: SDKMessage): void => {
      if (m.type === 'assistant' && !m.parent_tool_use_id) {
        for (const b of m.message.content) if (b.type === 'text') out.push(b.text)
      } else if (m.type === 'result') {
        cleanup()
        if (m.subtype === 'success') resolve(out.join('\n').trim())
        else reject(new Error(`ターンが失敗しました（${m.subtype}）`))
      }
    }
    const onError = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const onDone = (): void => {
      cleanup()
      reject(new Error('セッションが終わりました'))
    }
    session.on('message', onMessage)
    session.on('error', onError)
    session.on('done', onDone)
    try {
      session.send(text, [], origin)
    } catch (err) {
      // 終わったセッションに送ると投げる。待ち受けを残さない
      cleanup()
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/** 人の発言を司会に渡す形。司会の申し送りの「人の発言は最優先」と対になる */
const fromHuman = (entries: Entry[]): string[] =>
  entries.filter((e) => e.who === 'human').map((e) => `【あなた（人）】${e.text}`)

/**
 * 司会に渡す文の出どころ。**人の発言だけなら `human`、参加者の発言が混ざれば中継（`peer`）** ——
 * 続きを話すときの差分や「ここまでの発言」には参加者の言葉が入る。それを人の打鍵と名乗らせない（§26）
 */
const originOf = (entries: Entry[]): SDKUserMessage['origin'] =>
  // 空なら、送る文は Izuna が書いた一言だけ。人の打鍵とは名乗らない
  entries.length > 0 && entries.every((e) => e.who === 'human') ? { kind: 'human' } : RELAYED

/**
 * `Read` の先を実体で見る。**無いファイルは通す**（読んでも失敗するだけ）。それ以外で先が解けなければ、
 * 外とみなして断る —— 確かめられないものを通さない
 */
async function realOutside(path: string, cwd: string, roots: string[]): Promise<string | null> {
  let real: string
  try {
    real = await realpath(path)
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : path
  }
  const realRoots = await Promise.all(
    roots.map(async (r) => {
      try {
        return await realpath(r)
      } catch (err) {
        // 会議のフォルダがまだ無い等。字面のまま比べる
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return r
        throw err
      }
    })
  )
  return outsideScope('Read', { file_path: real }, cwd, realRoots) ? path : null
}

export class Meetings {
  readonly #runs = new Map<string, Run>()
  /**
   * 会議ごとの順番待ち。**発言録への書き足しと、起こすときの読み込みを同じ列に並べる** ——
   * 並べないと、読み込んだ直後に書き足された人の発言が、どちらにも載らずに落ちる
   */
  readonly #lanes = new Map<string, Lane>()
  readonly #emit: (event: SessionEvent) => void
  readonly #base: string
  readonly #rolesDir: string
  /** `members.json` の書き込みを 1 本にする。会議が 2 つ同時に走っても壊さない */
  readonly #membersWrite = lane()
  /** `meeting.json` の書き込みも 1 本にする。指名と閉会が同時に書いても、後の状態を失わない */
  readonly #metaWrite = lane()
  /** アプリを閉じている。新しい回を起こさない */
  #closing = false
  /** いま開いている参加者の claude のセッション。2 つの会議が同じ覚えを同時に resume しない */
  readonly #inUse = new Set<string>()

  constructor(
    emit: (event: SessionEvent) => void,
    opts: { base?: string; rolesDir?: string } = {}
  ) {
    this.#emit = emit
    this.#base = opts.base ?? MEETINGS_BASE
    this.#rolesDir = opts.rolesDir ?? ROLES_DIR
  }

  #send(id: string, event: MeetingEvent): void {
    this.#emit({ kind: 'meeting', id, event })
  }

  #lane(id: string): Lane {
    let l = this.#lanes.get(id)
    if (!l) {
      l = lane()
      this.#lanes.set(id, l)
    }
    return l
  }

  async roles(): Promise<Role[]> {
    const { roles, broken } = await loadRoles(this.#rolesDir)
    if (broken.length) console.warn(`[izuna] 読めない役: ${broken.join(', ')}（${this.#rolesDir}）`)
    return roles
  }

  /** 新しいものから。読めない控えは飛ばす。控えは並べて読む（会議が増えても待ちが伸びない） */
  async list(): Promise<MeetingSummary[]> {
    if (!(await exists(this.#base))) return []
    const ids = (await readdir(this.#base)).sort().reverse()
    const metas = await Promise.all(ids.map((id) => this.#meta(id)))
    return metas.flatMap((meta, i) =>
      meta
        ? [
            {
              id: ids[i],
              agenda: meta.agenda,
              cwd: meta.cwd,
              created: meta.created,
              state: meta.state,
              roles: meta.roles,
              running: this.#runs.has(ids[i])
            }
          ]
        : []
    )
  }

  async read(id: string): Promise<MeetingView> {
    const meta = await this.#meta(id)
    if (!meta) throw new Error(`会議が見つかりません: ${id}`)
    const dir = this.#dir(id)
    const entries = parseTranscript(await readFile(join(dir, 'transcript.md'), 'utf8'))
    const minutes = (await exists(join(dir, 'minutes.md')))
      ? await readFile(join(dir, 'minutes.md'), 'utf8')
      : ''
    return { meta, entries, minutes, running: this.#runs.has(id) }
  }

  async start(input: { cwd: string; agenda: string; roles: string[] }): Promise<string> {
    const agenda = input.agenda.trim()
    if (!agenda) throw new Error('議題が空です')
    const known = await this.roles()
    const roles = input.roles.filter((n) => known.some((r) => r.name === n))
    if (roles.length === 0) throw new Error('参加者を 1 人以上選んでください')

    await mkdir(this.#base, { recursive: true })
    // 識別子のフォルダを**作れたら自分のもの**にする。「無ければ作る」だと、同じ秒に 2 つ始めたとき
    // 両方が同じフォルダに書く
    const stamp = meetingIdFor(new Date())
    let id = stamp
    for (let n = 2; ; n++) {
      try {
        await mkdir(this.#dir(id))
        break
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        id = `${stamp}-${n}`
      }
    }
    const dir = this.#dir(id)

    const meta: MeetingMeta = {
      id,
      agenda,
      cwd: input.cwd,
      roles,
      created: new Date().toISOString(),
      state: 'open'
    }
    await writeJson(join(dir, 'meeting.json'), meta)
    await writeFile(
      join(dir, 'transcript.md'),
      `# ${agenda}\n\nIzuna が書く。エージェントは書かない。追記のみ。\n`,
      'utf8'
    )
    await this.#appendTo(dir, { at: meta.created, who: 'human', text: agenda })
    this.#run(id)
    return id
  }

  /**
   * 人が話す。**話している最中なら割り込み**として発言録に足し、司会への次の結果に混ぜる。
   * 止まっていれば、司会を resume して続きを話す（閉じた会議も開き直す）。
   *
   * どちらの場合も、司会が聞いた位置（`heard`）より後の人の発言は、必ずいつか司会に届く ——
   * 司会がもう指名しない間際に話しても、ターンの終わりに拾ってもう 1 ターン続ける。
   * 止めた直後（片付けの途中）に話したら、片付けが終わってから次の回で渡す。
   */
  async say(id: string, text: string): Promise<void> {
    const body = text.trim()
    if (!body) return
    if (!(await this.#meta(id))) throw new Error(`会議が見つかりません: ${id}`)
    const entry: Entry = { at: new Date().toISOString(), who: 'human', text: body }
    // 「次の回を起こすか」は書き足しと同じ列の中で決める。片付け（回を外す）も同じ列に並ぶので、
    // 片付けの前なら `again` が立ち、後なら回が無いので自分で起こす —— 間に落ちない
    const run = await this.#lane(id)(async () => {
      const r = this.#runs.get(id)
      if (r?.loaded) r.entries.push(entry)
      // 止められた回、まだ発言録を読んでいない回は、この一言を自分で渡せないかもしれない
      if (r && (r.stopped || !r.loaded)) r.again = true
      await this.#appendTo(this.#dir(id), entry)
      return r
    })
    this.#send(id, { kind: 'said', entry })
    if (!run) this.#run(id)
  }

  /** 締めるよう司会に頼む。**すぐには止めない** —— 次の指名の代わりに、閉じるよう返す */
  requestClose(id: string): void {
    const run = this.#runs.get(id)
    if (run) run.closeRequested = true
  }

  /** 人が止める。議事録は書かれない。続きは話せる。片付けが終わるまで待つ */
  async stop(id: string, timeoutMs = 3000): Promise<void> {
    const run = this.#runs.get(id)
    if (!run) return
    run.stopped = true
    await this.#stopSessions(run, timeoutMs)
    await settle(run.done, timeoutMs)
  }

  /** アプリを閉じるとき。起こしている途中の回も含めて全部止める */
  async stopAll(timeoutMs = 3000): Promise<void> {
    // 閉じているあいだは新しい回を起こさない（片付けの最後に `again` で起きる回も含めて）
    this.#closing = true
    await settle(
      Promise.all([...this.#runs.keys()].map((id) => this.stop(id, timeoutMs))),
      timeoutMs
    )
  }

  /** セッションを止める。何度呼んでも止める —— 止めたあとに起きたものも、最後の片付けで止まる */
  async #stopSessions(run: Run, timeoutMs = 3000): Promise<void> {
    await settle(
      Promise.all(
        [run.moderator, ...run.members.values()].map((s) => s?.stop() ?? Promise.resolve())
      ),
      timeoutMs
    )
  }

  #dir(id: string): string {
    // 識別子はフォルダ名。`..` や区切りを持ち込ませない
    if (!/^\d{8}-\d{6}(-\d+)?$/.test(id)) throw new Error(`会議の識別子が不正です: ${id}`)
    return join(this.#base, id)
  }

  async #meta(id: string): Promise<MeetingMeta | null> {
    try {
      return parseMeta(await readFile(join(this.#dir(id), 'meeting.json'), 'utf8'))
    } catch {
      return null
    }
  }

  /**
   * 控えを書き換える。**止められた回は書かない** —— 片付けの途中の回が、次の回の控えを
   * 古い写しで上書きしないように
   */
  async #update(run: Run, change: Partial<MeetingMeta>): Promise<void> {
    if (run.stopped) return
    run.meta = { ...run.meta, ...change }
    await this.#metaWrite(() => writeJson(join(run.dir, 'meeting.json'), run.meta))
  }

  async #appendTo(dir: string, entry: Entry): Promise<void> {
    await appendFile(join(dir, 'transcript.md'), formatEntry(entry), 'utf8')
  }

  /** 司会と参加者の発言を足す。**止められた回は書かない** */
  async #append(run: Run, entry: Entry): Promise<void> {
    if (run.stopped) return
    await this.#lane(run.id)(async () => {
      run.entries.push(entry)
      await this.#appendTo(run.dir, entry)
    })
    this.#send(run.id, { kind: 'said', entry })
  }

  /** 同じリポジトリの会議で、議事録があるもの。新しい順に `PAST_MINUTES` 件 */
  async #pastMinutes(
    all: MeetingSummary[],
    cwd: string,
    except: string
  ): Promise<Array<{ agenda: string; minutes: string }>> {
    const out: Array<{ agenda: string; minutes: string }> = []
    for (const m of all) {
      if (out.length >= PAST_MINUTES) break
      if (m.id === except || m.cwd !== cwd) continue
      const path = join(this.#dir(m.id), 'minutes.md')
      if (await exists(path)) out.push({ agenda: m.agenda, minutes: await readFile(path, 'utf8') })
    }
    return out
  }

  async #members(): Promise<Record<string, Record<string, string>>> {
    try {
      const v = JSON.parse(await readFile(join(this.#base, 'members.json'), 'utf8')) as unknown
      return typeof v === 'object' && v !== null
        ? (v as Record<string, Record<string, string>>)
        : {}
    } catch {
      return {}
    }
  }

  async #remember(cwd: string, role: string, sessionId: string): Promise<void> {
    await this.#membersWrite(async () => {
      const all = await this.#members()
      await writeJson(join(this.#base, 'members.json'), {
        ...all,
        [cwd]: { ...(all[cwd] ?? {}), [role]: sessionId }
      })
    })
  }

  /**
   * 会議の場で承認が来たら断る。道具は読むだけに絞ってあるので、来るのは外を読もうとしたとき。
   *
   * **壊れたことはここでは言わない。** 待っているターン（`turnOf`）が同じ失敗で返り、司会なら
   * `#drive` が、参加者なら発言録の「答えられませんでした」が言う。ここでも言うと通知が 2 度鳴る。
   * 聞き手を外すと EventEmitter が投げるので、記録にだけ残す
   */
  #deny(session: ClaudeSession): void {
    session.on('permission', (req) =>
      session.respondToPermission(req.id, {
        behavior: 'deny',
        message:
          '会議では読むだけです。作業ディレクトリと、このリポジトリの会議の記録の外は読めません'
      })
    )
    session.on('error', (err) => console.warn(`[izuna] 会議のセッション: ${err.message}`))
  }

  /** 起こす。同じ会議の回が載っていれば何もしない（2 人目の司会を起こさない） */
  #run(id: string): void {
    if (this.#runs.has(id) || this.#closing) return
    const run = new Run(id, this.#dir(id))
    this.#runs.set(id, run)
    run.done = this.#drive(run)
  }

  async #drive(run: Run): Promise<void> {
    const id = run.id
    this.#send(id, { kind: 'running', running: true })
    try {
      const meta = await this.#meta(id)
      if (!meta) throw new Error(`会議が見つかりません: ${id}`)
      run.meta = meta
      const known = await this.roles()
      run.roles = meta.roles.flatMap((n) => known.filter((r) => r.name === n))
      // 読み込みを、人の発言の書き足しと同じ列で行う。人の発言はこの前後どちらかに必ず載る
      await this.#lane(id)(async () => {
        run.entries = parseTranscript(await readFile(join(run.dir, 'transcript.md'), 'utf8'))
        run.began = run.entries.length
        run.loaded = true
        // 読む前に話された分はいま載った。この回が渡すので、止められていなければ次の回は要らない
        if (!run.stopped) run.again = false
      })
      run.halt()

      if (run.roles.length === 0) throw new Error('この会議の参加者の役が見つかりません')
      // 参加者はリポジトリの中で読む。**開く前にそのリポジトリの hook を見る**（§26）
      run.settingSources = await gateProjectHooks(meta.cwd)
      run.mask = (await loadConfig()).config.maskSecrets
      const all = await this.list()
      run.readable = all.filter((m) => m.cwd === meta.cwd).map((m) => this.#dir(m.id))
      run.halt()
      // 続きを話すなら開き直す。閉じたままだと、止めたときに「議事録あり」と言い続ける
      if (meta.state === 'closed') await this.#update(run, { state: 'open' })

      // 司会がいなければ（または resume が効かなければ）、議題とそれまでの発言で始める
      const past = await this.#pastMinutes(all, meta.cwd, id)
      const opening =
        openingPrompt(meta.agenda, past) +
        (run.entries.length > 1
          ? `\n\nここまでの発言:\n${deltaFor(run.entries, 1, run.roles)}`
          : '')
      // 過去の議事録は司会が申告したもの。添えるなら人の打鍵とは名乗らない
      const openingFrom = past.length > 0 ? RELAYED : originOf(run.entries)
      const unheard = run.entries.slice(meta.heard ?? 0)
      const resumed = [deltaFor(unheard, 0, run.roles), 'これを受けて会議を続けてください。']
        .filter(Boolean)
        .join('\n\n')
      run.modSeen = run.entries.length

      let moderator = await this.#moderator(run, meta.moderator)
      run.halt()
      try {
        await turnOf(
          moderator,
          meta.moderator ? resumed : opening,
          meta.moderator ? originOf(unheard) : openingFrom
        )
      } catch (err) {
        // resume が効かなかった印は「始まりの知らせが来ないまま失敗した」こと（2026-10-07 に測った。
        // 結果は一時的な失敗と同じ error_during_execution で、区別できるのはここだけ）。
        // 発言録は全部あるので、新しい司会に頭から渡せば続けられる
        if (run.stopped || !meta.moderator || moderator.sessionId) throw err
        await moderator.stop()
        await this.#update(run, { moderator: undefined })
        moderator = await this.#moderator(run, undefined)
        run.halt()
        await turnOf(moderator, opening, openingFrom)
      }
      await this.#heard(run)

      // ターンの終わりに、司会がまだ聞いていない人の発言があれば、もう 1 ターン続ける
      // 「締める」が押されたのに司会が閉じずに終えたら、閉じるよう頼む（押したことを落とさない）
      for (;;) {
        const pending = fromHuman(run.entries.slice(run.modSeen))
        const close = run.closeRequested && run.meta.state !== 'closed'
        if (run.stopped || (pending.length === 0 && !close)) break
        run.modSeen = run.entries.length
        const ask = close
          ? '人が閉会を求めています。izuna_close で閉じてください。'
          : 'これを受けて会議を続けてください。'
        // 人の発言が無く、Izuna の一言だけなら中継として送る
        await turnOf(
          moderator,
          [...pending, ask].join('\n\n'),
          pending.length ? { kind: 'human' } : RELAYED
        )
        await this.#heard(run)
        // 閉じるよう頼んでも閉じなければ、もう頼まない（同じ一言で回り続けない）
        if (close && run.meta.state !== 'closed') run.closeRequested = false
      }
    } catch (err) {
      // 載る前の失敗（役が読めない等）も言う。黙って起きないと、人には理由が分からない
      if (!run.stopped)
        this.#send(id, { kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      // 続きを起こすかは、止めた印を立てる前に決める
      const unheard = fromHuman(run.entries.slice(Math.max(run.modSeen, run.began)))
      const again = run.again || (!run.stopped && unheard.length > 0)
      // **この回はもう何もしない。** 指名の途中（参加者を開こうとしている等）でも、ここから後に
      // 起きたセッションは自分で止まり、書き込みもしない
      run.stopped = true
      await this.#stopSessions(run)
      // 指名の途中のものが抜けるのを待ち、そのあいだに起きたものも止める
      await settle(
        run.queue(async () => {}),
        3000
      )
      await this.#stopSessions(run)
      for (const claimed of run.claimed) this.#inUse.delete(claimed)
      for (const s of run.members.values()) if (s.sessionId) this.#inUse.delete(s.sessionId)
      // 外すのは人の発言の書き足しと同じ列で（`say` の註）
      await this.#lane(id)(async () => {
        this.#runs.delete(id)
      })
      this.#send(id, { kind: 'running', running: false })
      // 続きを話すのは 2 つの場合だけ。止めたあとに人が話した（`again`）か、止めていないのに
      // この回が始まったあとの人の発言を司会がまだ聞いていないか。それより前の分は、この回が
      // 渡そうとして失敗したもの —— 起こし直すと同じ失敗を繰り返す
      if (again) this.#run(id)
    }
  }

  async #moderator(run: Run, resume: string | undefined): Promise<ClaudeSession> {
    const moderator = new ClaudeSession({
      cwd: run.meta.cwd,
      settingSources: run.settingSources,
      tools: [],
      allowedTools: [NEXT, CLOSE],
      ...LOCKED,
      appendSystemPrompt: moderatorPrompt(run.roles),
      mcpServers: { izuna: this.#server(run) },
      mask: run.mask,
      ...(resume ? { resume } : {})
    })
    run.moderator = moderator
    this.#deny(moderator)
    await moderator.start()
    return moderator
  }

  /** 司会のセッションと、司会がどこまで聞いたかを控えに残す。止めても続きから話せるように */
  async #heard(run: Run): Promise<void> {
    const sessionId = run.moderator?.sessionId
    await this.#update(run, {
      heard: run.modSeen,
      ...(sessionId ? { moderator: sessionId } : {})
    })
  }

  #server(run: Run): ReturnType<typeof createSdkMcpServer> {
    const names = run.roles.map((r) => r.name) as [string, ...string[]]
    return createSdkMcpServer({
      name: 'izuna',
      tools: [
        tool(
          'izuna_next',
          '次に話す参加者を 1 人指名して聞く。その人が話し終わると、発言がこの結果として返る。',
          {
            speaker: z.enum(names).describe('指名する参加者の name'),
            ask: z.string().describe('その参加者に何を聞くか')
          },
          async (args) => ({
            content: [
              {
                type: 'text',
                text: await run.queue(() => this.#speak(run, args.speaker, args.ask))
              }
            ]
          })
        ),
        tool(
          'izuna_close',
          '論点が出尽くしたら会議を閉じる。Izuna が議事録に書く。',
          {
            decisions: z.array(z.string()).describe('決まったこと'),
            open: z.array(z.string()).describe('決まらずに残った問い'),
            actions: z.array(z.string()).describe('宿題。誰が何をするか')
          },
          async (args) => {
            await run.queue(() => this.#close(run, args))
            return {
              content: [{ type: 'text', text: '議事録に書きました。ここで会議を終えてください。' }]
            }
          }
        )
      ]
    })
  }

  async #speak(run: Run, speaker: string, ask: string): Promise<string> {
    const STOPPED = '会議は止められました。'
    // 司会が前に聞いた位置。人の割り込みは、**参加者が話し終わったあと**にここから拾う ——
    // 話しているあいだに来たものも落とさない
    const from = run.modSeen
    const reply = async (text: string): Promise<string> => {
      const human = fromHuman(run.entries.slice(from))
      run.modSeen = run.entries.length
      await this.#heard(run)
      return [...human, text].join('\n\n')
    }

    // 止めた会議では誰も起こさない。止めたセッションに話しかけて待たない
    if (run.stopped) return STOPPED
    if (run.closeRequested) return reply('人が閉会を求めています。izuna_close で閉じてください。')
    if (run.spoken >= MAX_TURNS)
      return reply(`発言が ${MAX_TURNS} 回に達しました。izuna_close で閉じてください。`)
    const role = run.roles.find((r) => r.name === speaker)
    if (!role) return `${speaker} という参加者はいません`

    await this.#append(run, {
      at: new Date().toISOString(),
      who: 'moderator',
      text: `${role.title}へ: ${ask.trim()}`
    })
    this.#send(run.id, { kind: 'speaking', who: role.name })
    run.spoken++

    let said: string
    try {
      said = await this.#hear(run, role)
    } catch (err) {
      said = `（${role.title} は答えられませんでした: ${err instanceof Error ? err.message : String(err)}）`
    }
    // 話しているあいだに止められたら、何も書かず、聞いた位置も動かさない ——
    // 止めたことで返った失敗を、その役の発言として残さない
    if (run.stopped) return STOPPED
    await this.#append(run, { at: new Date().toISOString(), who: role.name, text: said })
    return reply(`【${role.title}】${neutralize(said)}`)
  }

  /**
   * 参加者に差分を渡して聞く。前に渡した位置から後を渡し、**本人の発言は除く** ——
   * 本人は resume で、前の会議も、この会議の前の番も覚えている。
   *
   * resume が効かなかったら（記録が消えた等）、1 度だけ新しく起こす。**前の覚えは、新しい
   * セッションが話せたときにだけ置き換える** —— 一時的な失敗で覚えを消さない。
   * 人が止めたあとは、代わりを起こさない（誰も止めない claude が残る）。
   */
  async #hear(run: Run, role: Role): Promise<string> {
    const upto = run.entries.length
    const delta = deltaFor(
      run.entries.slice(run.meta.seen?.[role.name] ?? 0).filter((e) => e.who !== role.name),
      0,
      run.roles
    )
    let session = run.members.get(role.name)
    // 前の番のあとに落ちたセッションは使い回さない。同じ覚えから起こし直す
    let prior: string | undefined
    if (session && !session.running) {
      prior = session.sessionId
      // 自分が付けた「使用中」を外してから起こし直す（別の会議が使っていると取り違えない）
      if (prior) this.#inUse.delete(prior)
      run.members.delete(role.name)
      session = undefined
    }
    let said: string
    if (session) {
      said = await turnOf(session, delta, RELAYED)
    } else {
      prior ??= (await this.#members())[run.meta.cwd]?.[role.name]
      // 同じ覚えを別の会議が開いていたら、resume しない（2 つのプロセスが同じ記録に書くと文脈が混ざる）。
      // この会議では新しく起こし、覚えも置き換えない
      const shared = !!prior && this.#inUse.has(prior)
      if (shared) prior = undefined
      // 開く**前**に「使用中」にする。話し終わってからだと、そのあいだに別の会議が同じ覚えを開く
      if (prior) {
        this.#inUse.add(prior)
        run.claimed.add(prior)
      }
      // 新しく起こすときは、この会議の頭から渡す（前の番の差分だけでは議題も分からない）
      const whole = deltaFor(
        run.entries.filter((e) => e.who !== role.name),
        0,
        run.roles
      )
      try {
        session = await this.#open(run, role, prior)
        said = await turnOf(session, prior ? delta : whole, RELAYED)
      } catch (err) {
        // resume が効かなかったときだけ新しく起こす。印は「始まりの知らせが来ないまま失敗した」こと。
        // 一時的な失敗（API の過負荷など）なら知らせは先に来るので、覚えを捨てずにそのまま失敗にする
        if (!prior || run.stopped || run.members.get(role.name)?.sessionId) throw err
        this.#inUse.delete(prior)
        await run.members.get(role.name)?.stop()
        session = await this.#open(run, role, undefined)
        said = await turnOf(session, whole, RELAYED)
      }
      if (session.sessionId) {
        this.#inUse.add(session.sessionId)
        run.claimed.add(session.sessionId)
      }
      if (shared) {
        await this.#update(run, { seen: { ...(run.meta.seen ?? {}), [role.name]: upto } })
        return said
      }
    }
    if (run.stopped) return said
    if (session.sessionId) await this.#remember(run.meta.cwd, role.name, session.sessionId)
    // 渡したのは `upto` まで。話しているあいだに足された分は、次の番に渡す
    await this.#update(run, { seen: { ...(run.meta.seen ?? {}), [role.name]: upto } })
    return said
  }

  async #open(run: Run, role: Role, resume: string | undefined): Promise<ClaudeSession> {
    run.halt()
    const cwd = run.meta.cwd
    const roots = [cwd, ...run.readable]
    // 読む場所を道具が動く前に見る（`outsideScope` の註）。許可の規則に頼らない
    const scope = async (input: HookInput): Promise<HookJSONOutput> => {
      if (input.hook_event_name !== 'PreToolUse') return {}
      const toolInput = input.tool_input as Record<string, unknown>
      let out = outsideScope(input.tool_name, toolInput, cwd, roots)
      // 字面で中でも、記号リンクの先が外なら断る。`Read` の先と、`Grep` / `Glob` の `path` を実体で見る
      // （ripgrep は名指しされた記号リンクを辿る）
      for (const key of ['file_path', 'path']) {
        const p = toolInput[key]
        if (out || typeof p !== 'string' || !p) continue
        out = await realOutside(p.startsWith('/') ? p : join(cwd, p), cwd, roots)
      }
      return out
        ? {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: `会議では、このリポジトリと会議の記録の外は読めません（${out}）`
            }
          }
        : {}
    }
    const session = new ClaudeSession({
      cwd,
      settingSources: run.settingSources,
      tools: READ_ONLY,
      ...LOCKED,
      // 同じリポジトリの会議の記録だけを読めるようにする。書く道具は渡していない
      additionalDirectories: run.readable,
      appendSystemPrompt: personaPrompt(role, run.readable),
      hooks: { PreToolUse: [{ hooks: [scope] }] },
      mask: run.mask,
      ...(resume ? { resume } : {})
    })
    this.#deny(session)
    run.members.set(role.name, session)
    await session.start()
    // 起こしているあいだに止められたら、自分で片付ける
    if (run.stopped) {
      await session.stop()
      run.halt()
    }
    return session
  }

  async #close(run: Run, minutes: Minutes): Promise<void> {
    // 止めた会議の議事録は書かない（「止める」は議事録を書かずに止める約束）
    if (run.stopped) return
    const path = join(run.dir, 'minutes.md')
    if (!(await exists(path)))
      await writeFile(path, `# ${run.meta.agenda}\n\nIzuna が書く。追記のみ。\n`, 'utf8')
    await appendFile(path, formatMinutes(new Date().toISOString(), minutes), 'utf8')
    await this.#update(run, { state: 'closed' })
    // 閉じたら「締めて」は済んだ。このあと人が話して続いたとき、また閉じさせない
    run.closeRequested = false
    this.#send(run.id, { kind: 'closed', minutes: await readFile(path, 'utf8') })
  }
}
