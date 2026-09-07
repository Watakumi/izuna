import { mkdir, writeFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { slugifyBranch } from '../shared/worktree'

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

  await seed('brief.md',
    `---\ncreated: ${new Date().toISOString()}\n---\n\n# ${name}\n\n` +
    `## 狙い\n\n${brief?.trim() || '（ブレインが埋める）'}\n\n` +
    '## 制約\n\n## 受け入れ条件\n\n## 触らない範囲\n')
  await seed('decisions.md',
    '# 決めたこと\n\n追記のみ。書き換えない。見出しの形は変えない（Izuna が読む）。\n')
  await seed('log.md',
    '# 記録\n\nIzuna が書く。エージェントは書かない。追記のみ。1 行 1 件。\n' +
    '`<ISO8601>\\t<from>→<to>\\t<種別>\\t<対象>\\t<一言>`\n')

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
    '実行役の成果を読んだら、判断を `decisions.md` に追記してから次の指示を出してください。',
    ''
  ].join('\n')
}
