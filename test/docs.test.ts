import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * 文書と実装のズレを見つける門。
 *
 * なぜ要るか。Nimbalyst には `SafePathValidator` という
 * パス検証器があり、設計文書には安全機構として書かれ、専用の検査もある。
 * だが製品コードからは一度も呼ばれていない。検査は通り、文書は立派で、
 * コードは呼んでいない。「守られていない」より質が悪い。
 * **守られていると思い込ませる**からである。
 *
 * ここは同じ形を Izuna で検出する。CLAUDE.md に名前を書いた以上、
 * それは動いていなければならない。動かさないなら書くのをやめる。
 * どちらでもよいが、両方は許さない。
 */

const ROOT = join(__dirname, '..')

/**
 * 文書は 1 枚ではない（2026-09-08 に分けた）。CLAUDE.md は入口で、
 * 触るファイルに応じて `.claude/rules/*.md` が読まれ、背景は `docs/DECISIONS.md` にある。
 * 節番号は分ける前のままなので、**どのファイルにあっても `§N` は引ける**。
 * 門はその全部を 1 つの文書として見る。
 */
const DOC_FILES = [
  join(ROOT, 'CLAUDE.md'),
  ...readdirSync(join(ROOT, '.claude', 'rules'))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => join(ROOT, '.claude', 'rules', f)),
  join(ROOT, 'docs', 'DECISIONS.md')
]
const DOC = DOC_FILES.map((f) => readFileSync(f, 'utf8')).join('\n')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const srcFiles = walk(join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
/**
 * **コメントを剥がしてから数える。** 語で数えると、註に名前が出ているだけで
 * 「使われている」ことになる。実際に `projectDirName` と `until` がそれで
 * 通っていた（2026-09-08 に測った）。見たいのは呼び出しであって言及ではない。
 */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const src = new Map(
  srcFiles.map((f) => [relative(ROOT, f), stripComments(readFileSync(f, 'utf8'))])
)

const outsideFiles = [
  ...walk(join(ROOT, 'test')),
  ...walk(join(ROOT, 'scripts')),
  ...walk(join(ROOT, 'harness'))
].filter((f) => /\.(tsx?|js|mjs)$/.test(f))
const outside = outsideFiles.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n')

/** ` で囲まれた語をすべて取り出す */
const quoted = [...DOC.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])

describe('文書が名指しするファイル', () => {
  const paths = [
    ...new Set(
      quoted.filter((q) => /^(src|test|docs|scripts|harness|templates)\/[\w./-]+$/.test(q))
    )
  ]

  it('1 つ以上を検査対象にできている', () => {
    expect(paths.length).toBeGreaterThan(10)
  })

  it('規則のファイルには paths の frontmatter がある（無いと常に読まれる）', () => {
    for (const f of DOC_FILES.filter((p) => p.includes('/.claude/rules/'))) {
      const head = readFileSync(f, 'utf8').slice(0, 2000)
      expect(head, `${relative(ROOT, f)} に paths が無い`).toMatch(
        /^---\npaths:\n( {2}- ".+"\n)+---\n/
      )
    }
  })

  /**
   * 版管理に入れないと `.gitignore` に書いてあるもの（`session-full.ndjson` など手元専用の録画）は、
   * clone した先には無い。文書がそう書いている以上、実在の検査から外す。
   * それ以外は CI でも実在しなければならない（GitHub の CI で 2026-09-09 に踏んだ）
   */
  const ignored = readFileSync(join(ROOT, '.gitignore'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  const isIgnored = (p: string): boolean =>
    ignored.some((g) => {
      const re = new RegExp(
        '^' +
          g
            .replace(/^\//, '')
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '[^/]*') +
          '(/|$)'
      )
      return re.test(p)
    })

  it.each(paths.filter((p) => !isIgnored(p)))('%s が実在する', (p) => {
    expect(() => statSync(join(ROOT, p))).not.toThrow()
  })

  it('gitignore のものは実在を求めない（手元専用の録画）', () => {
    expect(isIgnored('test/fixtures/session-full.ndjson')).toBe(true)
    expect(isIgnored('test/fixtures/session-safe.ndjson')).toBe(false)
    expect(isIgnored('docs/v1-walk/01-x.png')).toBe(true)
    expect(isIgnored('docs/v1-walk/README.md')).toBe(false)
  })
})

describe('公開した値は製品コードから呼ばれている', () => {
  /** src の各ファイルが公開している値（型は除く。型は使われ方が違う） */
  const exported = new Map<string, string>()
  for (const [file, text] of src) {
    for (const m of text.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)) {
      exported.set(m[1], file)
    }
  }

  /** 文書が名前を挙げているか。挙げていれば、死んでいるとき文書が嘘になる */
  const documented = new Set(
    [...DOC.matchAll(/[`\s(]([A-Za-z_$][\w$]*)[`\s(]/g)]
      .map((m) => m[1])
      .filter((n) => exported.has(n))
  )

  it('検査対象を拾えている', () => {
    expect(exported.size).toBeGreaterThan(50)
  })

  /**
   * SafePathValidator の門。
   *
   * 「宣言している場所」以外に src の中で 1 回も現れない export は、
   * 製品コードから呼ばれていない。検査だけが呼んでいる場合、
   * その検査は**何も守っていない**。Izuna は library ではないので、
   * 外部の利用者という逃げ道は無い。呼ばれない export は、
   * 作りかけか、置き忘れかの、どちらかである。
   */
  it.each([...exported.keys()])('%s は製品コードから呼ばれている', (name) => {
    const home = exported.get(name)!
    const re = new RegExp(`\\b${name}\\b`, 'g')
    const uses = [...src].reduce((n, [file, text]) => {
      const hits = [...text.matchAll(re)].length
      // 宣言そのものは使用に数えない
      return n + (file === home ? hits - 1 : hits)
    }, 0)
    if (uses > 0) return

    const inTests = [...outside.matchAll(re)].length
    const doc = documented.has(name) ? 'CLAUDE.md はこれを機能として書いている。' : ''
    expect(
      uses,
      inTests > 0
        ? `${name}（${home}）は検査から ${inTests} 回呼ばれているが、製品コードからは 0 回。` +
            `検査は通るが何も守っていない。${doc}実装に繋ぐか、消すこと。`
        : `${name}（${home}）はどこからも呼ばれていない。${doc}`
    ).toBeGreaterThan(0)
  })
})

describe('節番号の参照', () => {
  const headings = new Set(
    [...DOC.matchAll(/^#{2,3} (\d+(?:\.\d+)?)[.．]?[ \u3000]/gm)].map((m) => m[1])
  )

  const refs = new Map<string, string>()
  for (const [file, text] of [...src, ['CLAUDE.md', DOC] as const]) {
    for (const m of text.matchAll(/§(\d+(?:\.\d+)?)/g)) refs.set(m[1], file)
  }

  it('見出しを拾えている', () => {
    expect(headings.size).toBeGreaterThan(10)
  })

  it.each([...refs])('§%s（%s から参照）が見出しとして実在する', (n) => {
    expect(headings, `§${n} は CLAUDE.md に無い見出し`).toContain(n)
  })
})

describe('「やらない」と書いたことが守られている', () => {
  it('Izuna は worktree を作らない', () => {
    const creators = [...src].filter(([, t]) => /worktree\s+add/.test(t))
    expect(creators.map(([f]) => f)).toEqual([])
  })

  it('トークンを URL にも引数にも埋め込まない', () => {
    // https://<token>@host の形と、コマンド引数への直書き
    const leaks = [...src].filter(([, t]) => /https:\/\/\$\{?\w*[Tt]oken/.test(t))
    expect(leaks.map(([f]) => f)).toEqual([])
  })
})

/**
 * **自己紹介は 1 文で、置き場が 3 つある。** package.json の description、README の 1 行目、
 * CLAUDE.md の 1 行目。Orca は 8 通りに割れていた（docs/ORCA.md §6）。Izuna も 3 通りに割れて
 * いたので（2026-09-11）、置き場を数えて同じであることを門にする。GitHub の description は
 * ここでは見られない（人が `gh repo edit` で揃える）。
 */
describe('自己紹介は 1 文', () => {
  const firstLineAfterTitle = (text: string): string =>
    text
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .find((l) => l !== '') ?? ''
  const description = (
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { description: string }
  ).description
  /** 日本語の 1 文。英語と同じことを言う。変えるときは両方を変える（DECISIONS §20） */
  const JA = 'Claude Code を自分の Forgejo と一緒にデスクトップから使う macOS アプリ'

  it('英語: package.json の description と README の 1 行目が同じ文', () => {
    expect(description.length).toBeGreaterThan(10)
    expect(firstLineAfterTitle(readFileSync(join(ROOT, 'README.md'), 'utf8'))).toBe(
      `${description}.`
    )
  })

  it('日本語: README.ja.md と CLAUDE.md の 1 行目が同じ文', () => {
    expect(firstLineAfterTitle(readFileSync(join(ROOT, 'README.ja.md'), 'utf8'))).toBe(`${JA}。`)
    expect(firstLineAfterTitle(readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8'))).toBe(`${JA}。`)
  })
})
