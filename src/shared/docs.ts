import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk'

/**
 * 資料の skill（`.claude/skills/doc-*`。docs/FRAMEWORKS.md）を、右パネルの「資料」タブに出す形に読む。
 *
 * `/` パレットでも同じものが呼べるが、名前を覚えていないと出てこない。タブは
 * **使えるものを説明つきで並べ、押せば頼める**入口で、何を読んで何を書くかが押す前に見える
 * （2026-09-11、利用者の「コマンドで呼ぶのではなく別の呼び方があると UX が上がる」から）。
 * 判定は名前の `doc-` だけ。skill の description は「資料 — 枠組み。説明」の形で書く約束。
 */
export interface DocSkill {
  name: string
  /** 枠組みの名前（「資料 — 」と末尾の「(project)」を落としたもの） */
  title: string
  /** 何をするか。1 文だけ（description の残りは、skill を選ぶための言葉で、人が読むものではない） */
  detail: string
  argumentHint: string
}

export const DOC_PREFIX = 'doc-'

export function docSkills(commands: SlashCommand[]): DocSkill[] {
  return commands
    .filter((c) => c.name.startsWith(DOC_PREFIX))
    .map((c) => {
      const desc = c.description
        .replace(/\s*\((project|user|local)\)\s*$/, '')
        .replace(/^資料\s*[—-]\s*/, '')
        .trim()
      const [title, ...rest] = desc.split('。')
      // description の後半は「〜したい、といった依頼で使う」という**起動の言葉**で、
      // エージェントが skill を選ぶためにある。画面に出すのは何をするかの 1 文だけ
      return {
        name: c.name,
        title: title.trim() || c.name,
        detail: rest[0]?.trim() ?? '',
        argumentHint: c.argumentHint ?? ''
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 会話に送る文。パレットで打つのと同じ `/name 引数` */
export function docRequest(skill: DocSkill, args: string): string {
  const a = args.trim()
  return a ? `/${skill.name} ${a}` : `/${skill.name}`
}
