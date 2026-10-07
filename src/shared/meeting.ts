import { normalize, readableUnder } from './readfile'
/**
 * 会議（§39）。司会 1 人と参加者が話し、Izuna が発言録と議事録を書く。
 *
 * ここは純粋関数だけ（§4）。プロセスもファイルも知らない。駆動は `main/meeting.ts`。
 *
 * **ブレインと実行役（§12）とは別物。** あちらは作業を分けて手を動かす。
 * こちらは手を動かさない —— 参加者の道具は読むだけに絞る。
 */

/** 参加者の役。`~/.izuna/roles/<name>.md` が 1 件 1 ファイル */
export interface Role {
  /** 識別子。ファイル名と同じ。発言録の話者にもこれを書く */
  name: string
  /** 画面に出す名前 */
  title: string
  /** どの立場から話すか。参加者の申し送りにそのまま入る */
  brief: string
}

/**
 * 同梱の役。`~/.izuna/roles/` が無いときだけ、ここから書き出す。
 *
 * **ファイルに書き出してから読む。** 利用者が直す・足す・消すのはファイルのほうで、
 * 消した役をここから黙って戻さない（置き場が既にあれば書き出さない）。
 * 用途は 2026-10-06 に利用者が選んだ 3 つ（実装前の設計相談・プロダクトの判断・壁打ち）。
 */
export const DEFAULT_ROLES: Role[] = [
  {
    name: 'architect',
    title: '設計',
    brief:
      '構造・依存の向き・変更のしやすさから意見を言う。いま決めなくてよいことは、後で決められる形を示す。'
  },
  {
    name: 'security',
    title: 'セキュリティ',
    brief:
      '鍵・権限・データの漏れ・信頼の境界から意見を言う。危ないものは何が漏れるかを具体的に言う。'
  },
  {
    name: 'tester',
    title: '検査',
    brief: 'どう確かめるか、何が壊れうるかから意見を言う。確かめられない案には、確かめ方を求める。'
  },
  {
    name: 'pdm',
    title: 'PdM',
    brief:
      '誰の何の問題を解くか、作る順番、作らないものから意見を言う。手段の話が続いたら目的に戻す。'
  },
  {
    name: 'user',
    title: '利用者',
    brief:
      'これを毎日使う人として意見を言う。手順の多さ、分かりにくい言葉、待たされる場面を挙げる。'
  },
  {
    name: 'critic',
    title: '反論',
    brief:
      '出ている案の弱いところを突く。全員が賛成しているときほど反対の立場を取る。代わりの案も 1 つ出す。'
  }
]

/** 役の識別子に使える字。ファイル名になるので狭く取る */
const ROLE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/

export function isRoleName(name: string): boolean {
  return ROLE_NAME.test(name) && name !== 'human' && name !== 'moderator'
}

/**
 * 役のファイルを読む。`name` はファイル名から取る（中に書かせると食い違う）。
 *
 * ```
 * ---
 * title: 設計
 * ---
 * 構造・依存の向き・…から意見を言う。
 * ```
 *
 * **壊れたものは黙って直さない。** 題が無い、本文が空なら null —— 呼ぶ側が名指しで言う。
 */
export function parseRole(name: string, text: string): Role | null {
  if (!isRoleName(name)) return null
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'))
  if (!m) return null
  const title = /^title:\s*(.+)$/m.exec(m[1])?.[1]?.trim()
  const brief = m[2].trim()
  if (!title || !brief) return null
  return { name, title, brief }
}

export function serializeRole(role: Role): string {
  return `---\ntitle: ${role.title}\n---\n\n${role.brief}\n`
}

/** 発言録の 1 件 */
export interface Entry {
  at: string
  /** `human` / `moderator` / 役の name */
  who: string
  text: string
}

/**
 * 発言録（`transcript.md`）の 1 件。**Izuna だけが書く。追記のみ。**
 *
 * 見出しは `## <ISO8601> · <話者>`。本文に `## ` が出ても、
 * 時刻と話者の形をしていなければ見出しとして読まない。
 */
export function formatEntry(e: Entry): string {
  // **本文の中の見出しの形を打ち消す。** エージェントの発言に `## <時刻> · human` の行が混ざると、
  // 読み直したときに人の発言に化ける（出どころを偽る。§26）。行頭に `\` を置き、読むときに外す
  // 改行を先に揃える。`\r\n` のままだと行末の `\r` で見出しの形に当たらず、読むときに
  // `\r` が落ちて見出しになる（2026-10-07 のレビューで指摘）
  const body = e.text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map((l) => (HEADING.test(l.replace(/^\\+/, '')) ? `\\${l}` : l))
    .join('\n')
  return `\n## ${e.at} · ${e.who}\n\n${body}\n`
}

const HEADING = /^## (\d{4}-\d{2}-\d{2}T[\d:.]+Z) · (human|moderator|[a-z0-9][a-z0-9-]{0,31})$/

export function parseTranscript(text: string): Entry[] {
  const out: Entry[] = []
  let cur: Entry | null = null
  const body: string[] = []
  const flush = (): void => {
    if (cur) out.push({ ...cur, text: body.join('\n').trim() })
    body.length = 0
  }
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const h = HEADING.exec(line)
    if (h) {
      flush()
      cur = { at: h[1], who: h[2], text: '' }
    } else if (cur) {
      // 書くときに付けた打ち消しを 1 つ外す
      body.push(
        /^\\+## /.test(line) && HEADING.test(line.replace(/^\\+/, '')) ? line.slice(1) : line
      )
    }
  }
  flush()
  return out
}

/** 会議の控え（`meeting.json`）。Izuna だけが書く */
export interface MeetingMeta {
  id: string
  agenda: string
  /** 参加者が読むリポジトリ。resume はここに紐づく（claude の記録が cwd ごとだから） */
  cwd: string
  roles: string[]
  created: string
  /** 司会の claude のセッション。続きを話すときに resume する */
  moderator?: string
  /** `closed` は司会が議事録を書いた。続きを話せば `open` に戻る */
  state: 'open' | 'closed'
  /**
   * 参加者ごとに、発言録のどこまでを渡したか。続きを話すとき、本人が既に聞いた分を
   * 渡し直さない（本人は resume で覚えている）
   */
  seen?: Record<string, number>
  /**
   * 司会が発言録のどこまでを聞いたか。続きを話すとき、ここから後を渡す ——
   * 止めた・落ちたあいだに人が話した分も、次に司会が起きたときに届く
   */
  heard?: number
}

/** 読めない控えは null。黙って既定に倒さない（§12 と同じ規律） */
export function parseMeta(text: string): MeetingMeta | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const str = (k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null)
  const id = str('id')
  const agenda = str('agenda')
  const cwd = str('cwd')
  const created = str('created')
  const state = str('state')
  if (!id || !agenda || !cwd || !created) return null
  if (state !== 'open' && state !== 'closed') return null
  if (!Array.isArray(o.roles) || !o.roles.every((r) => typeof r === 'string' && isRoleName(r)))
    return null
  const moderator = str('moderator')
  const seen =
    typeof o.seen === 'object' && o.seen !== null
      ? Object.fromEntries(
          Object.entries(o.seen as Record<string, unknown>).filter(
            (kv): kv is [string, number] => Number.isInteger(kv[1]) && (kv[1] as number) >= 0
          )
        )
      : undefined
  const heard = Number.isInteger(o.heard) && (o.heard as number) >= 0 ? (o.heard as number) : null
  return {
    id,
    agenda,
    cwd,
    roles: o.roles as string[],
    created,
    state,
    ...(moderator ? { moderator } : {}),
    ...(seen ? { seen } : {}),
    ...(heard !== null ? { heard } : {})
  }
}

/** 一覧の 1 行 */
export interface MeetingSummary {
  id: string
  agenda: string
  cwd: string
  created: string
  state: MeetingMeta['state']
  roles: string[]
  /** いま話している最中か */
  running: boolean
}

/** 1 つの会議を開いたときに見せるもの */
export interface MeetingView {
  meta: MeetingMeta
  entries: Entry[]
  /** `minutes.md` の中身。まだ閉じていなければ空 */
  minutes: string
  running: boolean
}

/** main から renderer に流す会議の出来事 */
export type MeetingEvent =
  | { kind: 'said'; entry: Entry }
  | { kind: 'speaking'; who: string }
  | { kind: 'running'; running: boolean }
  | { kind: 'closed'; minutes: string }
  | { kind: 'error'; message: string }

/** 司会が閉じるときに申告するもの。**文面から推測しない**（§23 と同じ規律） */
export interface Minutes {
  decisions: string[]
  open: string[]
  actions: string[]
}

/**
 * 議事録（`minutes.md`）の 1 回分。**追記のみ。** 続きを話してまた閉じたら、下に足す ——
 * 前の回で何が決まっていたかを消さない。
 */
export function formatMinutes(at: string, m: Minutes): string {
  const list = (xs: string[]): string =>
    xs.length ? xs.map((x) => `- ${x.trim()}`).join('\n') : '- なし'
  return (
    `\n## ${at}\n\n### 決まったこと\n\n${list(m.decisions)}\n\n` +
    `### 残った問い\n\n${list(m.open)}\n\n### 宿題\n\n${list(m.actions)}\n`
  )
}

/** 画面と申し送りに出す話者の名前 */
export function speakerTitle(who: string, roles: Role[]): string {
  if (who === 'human') return 'あなた'
  if (who === 'moderator') return '司会'
  return roles.find((r) => r.name === who)?.title ?? who
}

/**
 * 参加者に渡す「前の番から後」。**全文を毎回渡さない** ——
 * 参加者は resume で自分の文脈を持っているので、渡すのは差分だけでよい（2026-10-06 に測った）。
 */
export function deltaFor(entries: Entry[], from: number, roles: Role[]): string {
  return entries
    .slice(from)
    .map(
      (e) => `【${speakerTitle(e.who, roles)}】${e.who === 'human' ? e.text : neutralize(e.text)}`
    )
    .join('\n\n')
}

/**
 * エージェントの発言の中の `【` を別の括弧に替える。**話者の札を偽らせない** —— 参加者が
 * `【あなた（人）】…` と書くと、司会にはその行が人の割り込みに見える（司会は人の発言を最優先する）。
 * 発言録のファイルでは見出しの形を打ち消すのと同じ理由（`formatEntry`。§26）
 */
export function neutralize(text: string): string {
  return text.replace(/【/g, '［').replace(/】/g, '］')
}

/** 1 回の会議で参加者が話せる回数。超えたら司会に閉じさせる */
export const MAX_TURNS = 8

/**
 * 参加者の申し送り。`meetings` は**同じリポジトリの**会議のフォルダだけ ——
 * よそのリポジトリの会議は読ませない（読める場所もこれに絞る）
 */
export function personaPrompt(role: Role, meetings: string[]): string {
  return [
    `あなたは会議の参加者「${role.title}」。${role.brief}`,
    '司会に指名されたときだけ話す。300 字以内。ほかの参加者には名前を挙げて応じてよい。',
    'リポジトリのファイルは読んでよいが、書かない。会議では手を動かさない。',
    meetings.length
      ? 'このリポジトリの会議の記録（minutes.md が議事録、transcript.md が発言録）:\n' +
        meetings.map((d) => `- ${d}`).join('\n') +
        '\n前に決めたことと食い違うなら、そう言う。'
      : 'このリポジトリの過去の会議はまだない。',
    'あなたは前の会議の発言も覚えている。前に言ったことを変えるなら、変えた理由を言う。'
  ].join('\n')
}

export function moderatorPrompt(roles: Role[]): string {
  return [
    'あなたは会議の司会。参加者は ' +
      roles.map((r) => `${r.name}（${r.title}: ${r.brief}）`).join('、') +
      '。',
    '毎回、izuna_next で 1 人を指名して聞く。指名した人の発言がツールの結果として返る。',
    '結果には、人（依頼者）の割り込みが入ることがある。人の発言は最優先で扱う。',
    '自分では意見を言わない。論点を絞り、食い違いを当事者同士にぶつけ、決まっていないことを残さない。',
    // 数えるのは 1 回の進行ごと。人が始めるか続けるたびに、また ${MAX_TURNS} 回 ——
    // 費用の上限が人の操作 1 回ごとに決まる（2026-10-07 のレビューで「合計」と食い違うと指摘）
    `参加者の発言は、人が始めるか続けるたびに ${MAX_TURNS} 回まで。論点が出尽くしたら izuna_close で閉じる。`,
    'izuna_close には、決まったこと・残った問い・宿題（誰が何を）を書く。'
  ].join('\n')
}

/** 会議を始める最初の 1 通。同じリポジトリの過去の議事録を添える */
export function openingPrompt(
  agenda: string,
  past: Array<{ agenda: string; minutes: string }>
): string {
  const history = past.length
    ? '\n\nこのリポジトリの過去の会議（新しい順）:\n' +
      past.map((p) => `### ${p.agenda}\n${p.minutes.trim()}`).join('\n\n')
    : ''
  return `議題: ${agenda}${history}\n\n会議を始めてください。`
}

/** 渡す過去の議事録の数。多いと司会の窓を食う */
export const PAST_MINUTES = 3

/** 会議の識別子。フォルダ名になる。時刻順に並ぶ形にする */
export function meetingIdFor(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  )
}

/**
 * 参加者の道具の入力が、読んでよい場所の外を指していればそのパスを返す（§39）。
 *
 * **許可の規則に頼らない。** 参加者はリポジトリの設定（`project` / `local`）を読むので、そこに
 * 許可の規則があれば承認を経ずに通りうる。道具が動く前の hook（PreToolUse）でこれを見て断る ——
 * 規則の書き方によらず、同じ判定で止まる。
 *
 * 見るのは `Read` の `file_path`、`Glob` の `path` と `pattern`（`path` から解く）、`Grep` の `path`。
 * `Grep` の `pattern` は正規表現でパスではない。`~` で始まるものは、解き方が道具任せなので断る。
 * 記号リンクの先は見ない（未検証）。
 */
export function outsideScope(
  tool: string,
  input: Record<string, unknown>,
  cwd: string,
  roots: string[]
): string | null {
  const str = (k: string): string | null =>
    typeof input[k] === 'string' && input[k] ? (input[k] as string) : null
  const check = (raw: string, from: string): string | null => {
    if (raw.startsWith('~')) return raw
    const abs = normalize(raw.startsWith('/') ? raw : `${from}/${raw}`)
    return readableUnder(roots, abs) ? null : raw
  }
  const base = str('path')
  const where = base ? check(base, cwd) : null
  if (where) return where
  if (tool === 'Read') return str('file_path') ? check(str('file_path')!, cwd) : null
  // Glob の `{a,..}` は、字面では中に見えても展開すると `..` になる。`..` と `{` を含む形は断る
  if (tool === 'Glob' && str('pattern') && /\.\.|\{/.test(str('pattern')!)) return str('pattern')
  if (tool === 'Glob' && str('pattern'))
    return check(
      str('pattern')!,
      base ? normalize(base.startsWith('/') ? base : `${cwd}/${base}`) : cwd
    )
  return null
}
