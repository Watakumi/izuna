import { mkdir, writeFile, access, readFile, readdir, appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { slugifyBranch } from '../shared/worktree'
import {
  formatLogEntry,
  parseBrief,
  parseDecisions,
  parseLog,
  parseSummary,
  parseTask,
  pathCollisions,
  readyTasks,
  serializeTask,
  type Brief,
  type Decision,
  type LogEntry,
  type Summary,
  type Task,
  type TaskStatus
} from '../shared/team'

/**
 * 共有フォルダ（CLAUDE.md §12）。
 *
 * ブレインと実行役はコンテキストの窓を共有しない。共有されるのはここだけで、
 * **圧縮を跨いで残るのもここだけ**。だから場所を決め、規律ごとブレインに伝える。
 *
 * 形は `templates/team/` が実物の雛形で、`test/team.test.ts` が門になっている。
 */

export const TEAMS_BASE = join(homedir(), '.izuna', 'teams')

export function teamPathFor(name: string): string {
  return join(TEAMS_BASE, slugifyBranch(name) || 'team')
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * 無ければ作る。**既にあるものは触らない** ——
 * `decisions.md` と `log.md` は追記のみで、書き換えると誰がいつ何を決めたのかが
 * 復元できなくなる。
 */
export async function ensureTeam(name: string, brief?: string): Promise<string> {
  const dir = teamPathFor(name)
  await mkdir(join(dir, 'tasks'), { recursive: true })
  await mkdir(join(dir, 'summaries'), { recursive: true })

  const seed = async (file: string, body: string): Promise<void> => {
    const path = join(dir, file)
    if (!(await exists(path))) await writeFile(path, body, 'utf8')
  }

  await seed(
    'brief.md',
    `---\ncreated: ${new Date().toISOString()}\n---\n\n# ${name}\n\n` +
      `## 狙い\n\n${brief?.trim() || '（ブレインが埋める）'}\n\n` +
      '## 制約\n\n## 受け入れ条件\n\n## 触らない範囲\n'
  )
  await seed(
    'decisions.md',
    '# 決めたこと\n\n追記のみ。書き換えない。見出しの形は変えない（Izuna が読む）。\n'
  )
  await seed(
    'log.md',
    '# 記録\n\nIzuna が書く。エージェントは書かない。追記のみ。1 行 1 件。\n' +
      '`<ISO8601>\\t<from>→<to>\\t<種別>\\t<対象>\\t<一言>`\n'
  )

  return dir
}

/**
 * ブレインへの申し送り。**場所を教えるだけでは使われない**ので、
 * 書き手の割り当てと追記のみの規律まで書く。
 */
export function teamInstructions(dir: string): string {
  return [
    '',
    '## 共有フォルダ',
    '',
    `あなたと実行役は ${dir} を共有しています。コンテキストの窓は共有しません。`,
    '**圧縮を跨いで残るのはこのフォルダだけ**なので、口頭で伝えたことは残らないと考えてください。',
    '',
    '- `brief.md` — 狙い・制約・受け入れ条件・触らない範囲。あなたが書きます',
    '- `tasks/NN-*.md` — 作業単位。担当・ブランチ・状態・`paths`（触ってよいパス）。あなたが書きます',
    '- `summaries/*.md` — 実行役が手を止めるときに書く要約。あなたは読むだけです',
    '- `decisions.md` — 反省で決まったこと。**追記のみ。書き換えない**',
    '- `log.md` — Izuna が書きます。あなたは触らないでください',
    '',
    '実行役を起こす前に、`tasks/` に作業を分けて書いてください。',
    '**`paths` が重なる作業を同時に走らせないこと** —— 並列で最も壊れるのは、',
    '2 人が同じファイルを触ることです。',
    '',
    '## 実行役の起こし方（2026-09-09 に実測した手順）',
    '',
    '- `Agent` ツールで起こします。`run_in_background: true` と **`isolation: "worktree"`** を付けてください。',
    '  worktree は `<リポジトリ>/.claude/worktrees/agent-<id>`、ブランチは `worktree-agent-<id>` に自動で作られます',
    '- **実行役に `EnterWorktree` を呼ばせないでください。** サブエージェントからは使えず、失敗します',
    '- **Bash で共有フォルダへ `cd` しないでください。** シェルの居場所が残り、次に起こす worktree が',
    '  「git のリポジトリではない」で失敗します（2026-09-09 に踏んだ）。共有フォルダは絶対パスで読み書きしてください',
    '- 実行役の依頼文に、触ってよいパス（`paths`）と、終わるときに `summaries/` へ要約を書くことを含めてください',
    '- 実行役が手を止めると通知が届きます。追加の指示は `SendMessage` で同じ実行役に送れます（止まった実行役も続きから起きます）',
    '- 実行役の承認は人に届きます。あなたが代わりに許可することはできません',
    '',
    '実行役の成果を読んだら、判断を `decisions.md` に追記してから次の指示を出してください。',
    ''
  ].join('\n')
}

// ── 盤面 ────────────────────────────────────────────────
//
// CLAUDE.md §16 は「`paths` が重なる作業を同時に走らせない」を
// **実行役を起こす前に必ず通す**検査だと書いている。書いただけでは通らない。
// ここが読んで、`register.ts` が返し、右パネルが出す。

/** 盤面。壊れた札は落とさずに `errors` に出す —— 黙って消すと書いた本人が気づけない */
export interface TeamBoard {
  dir: string
  brief: Brief
  tasks: Task[]
  errors: string[]
  summaries: Summary[]
  decisions: Decision[]
  log: LogEntry[]
  /** 同時に走らせてはいけない組。空でなければ UI が止める */
  collisions: Array<{ a: string; b: string; paths: string[] }>
  /** depends_on が満たされていて未着手のもの */
  ready: Task[]
}

const read = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

const listDir = async (path: string): Promise<string[]> => {
  try {
    return (await readdir(path)).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return []
  }
}

export async function readBoard(dir: string): Promise<TeamBoard> {
  const [briefSrc, decisionsSrc, logSrc, taskFiles, summaryFiles] = await Promise.all([
    read(join(dir, 'brief.md')),
    read(join(dir, 'decisions.md')),
    read(join(dir, 'log.md')),
    listDir(join(dir, 'tasks')),
    listDir(join(dir, 'summaries'))
  ])

  const tasks: Task[] = []
  const errors: string[] = []
  for (const f of taskFiles) {
    const r = parseTask(await read(join(dir, 'tasks', f)))
    if (r.ok) tasks.push(r.value)
    else errors.push(`tasks/${f}: ${r.error}`)
  }

  const summaries: Summary[] = []
  for (const f of summaryFiles) {
    const r = parseSummary(await read(join(dir, 'summaries', f)))
    if (r.ok) summaries.push(r.value)
    else errors.push(`summaries/${f}: ${r.error}`)
  }

  return {
    dir,
    brief: parseBrief(briefSrc),
    tasks,
    errors,
    summaries,
    decisions: parseDecisions(decisionsSrc),
    log: parseLog(logSrc),
    collisions: pathCollisions(tasks),
    ready: readyTasks(tasks)
  }
}

/**
 * `log.md` は Izuna が書く（§16）。**追記のみ** ——
 * 書き換えを許すと、誰がいつ何をしたのかが復元できなくなる。
 */
export async function appendLog(dir: string, entry: LogEntry): Promise<void> {
  await mkdir(dir, { recursive: true })
  await appendFile(join(dir, 'log.md'), formatLogEntry(entry) + '\n', 'utf8')
}

/**
 * 札の状態だけを書き換える。本文と他の欄はそのまま返す
 * （`serializeTask` は読んだものを組み立て直すので、書いた人の本文が消えない）。
 */
export async function setTaskStatus(dir: string, id: string, status: TaskStatus): Promise<boolean> {
  for (const f of await listDir(join(dir, 'tasks'))) {
    const path = join(dir, 'tasks', f)
    const r = parseTask(await read(path))
    if (!r.ok || r.value.id !== id) continue
    const next = { ...r.value, status, updated: new Date().toISOString() }
    await writeFile(path, serializeTask(next), 'utf8')
    return true
  }
  return false
}
