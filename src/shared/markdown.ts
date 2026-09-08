/**
 * 会話に出る markdown を解釈する。
 *
 * **HTML を作らない。** 木を返して React が要素を組む。
 * LLM の出力をそのまま `dangerouslySetInnerHTML` に流すと、Electron で
 * script 注入の口になる。木のまま渡せば、その心配が構造的に消える。
 *
 * **完全な markdown は目指さない。** 実際に出てくるものだけを扱う ——
 * 見出し・段落・箇条書き・番号付き・コード・引用・区切り・表と、
 * 行内の強調・コード・リンク。
 *
 * **途中の文字列でも壊れないこと。** 逐次描画では `**` が閉じる前の状態が
 * 必ず通る。閉じていない印は**そのまま文字として出す**（消してはいけない ——
 * 書きかけの記号が消えると、何が起きているか分からなくなる）。
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'strike'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] }
  | { kind: 'image'; src: string; alt: string }

export interface ListItem {
  children: Inline[]
  /** 1 段だけ入れ子を許す。それ以上は実際に出てこない */
  sub: Node | null
}

export type Node =
  | { kind: 'p'; children: Inline[] }
  | { kind: 'heading'; level: number; children: Inline[] }
  | { kind: 'code'; lang: string | null; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'quote'; children: Node[] }
  | { kind: 'hr' }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][]; align: Array<'left' | 'center' | 'right'> }

// ── 行内 ──────────────────────────────────────────────

/** 閉じ位置を探す。見つからなければ -1（＝印を文字として扱う） */
function closing(src: string, from: number, mark: string): number {
  let at = src.indexOf(mark, from)
  while (at !== -1) {
    if (src[at - 1] !== '\\') return at
    at = src.indexOf(mark, at + 1)
  }
  return -1
}

/** 印は長いものから見る（`***` を `*` に食われないように） */
const MARKS = [
  ['***', 'strong'],
  ['**', 'strong'],
  ['~~', 'strike'],
  ['__', 'strong'],
  ['*', 'em'],
  ['_', 'em']
] as const

/** 位置 `i` から 1 つ取れるか。取れなければ null（＝ただの文字） */
function matchAt(src: string, i: number): { node: Inline; next: number } | null {
  // `code` を最優先にする。中の * や _ は記号のままでなければならない
  if (src[i] === '`') {
    const end = closing(src, i + 1, '`')
    if (end !== -1) return { node: { kind: 'code', text: src.slice(i + 1, end) }, next: end + 1 }
  }

  // `![alt](src)` を `[alt](src)` より先に見る。**順を逆にすると画像がリンクになる**
  if (src[i] === '!' && src[i + 1] === '[') {
    const close = closing(src, i + 2, ']')
    if (close !== -1 && src[close + 1] === '(') {
      const paren = closing(src, close + 2, ')')
      if (paren !== -1) {
        return {
          node: { kind: 'image', src: src.slice(close + 2, paren).trim(), alt: src.slice(i + 2, close) },
          next: paren + 1
        }
      }
    }
  }

  if (src[i] === '[') {
    const close = closing(src, i + 1, ']')
    if (close !== -1 && src[close + 1] === '(') {
      const paren = closing(src, close + 2, ')')
      if (paren !== -1) {
        return {
          node: { kind: 'link', href: src.slice(close + 2, paren).trim(), children: parseInline(src.slice(i + 1, close)) },
          next: paren + 1
        }
      }
    }
  }

  for (const [mark, kind] of MARKS) {
    if (!src.startsWith(mark, i)) continue
    const end = closing(src, i + mark.length, mark)
    // 閉じていない、または中身が空（`****`）なら印のまま文字として出す
    if (end === -1 || end === i + mark.length) continue
    return { node: { kind, children: parseInline(src.slice(i + mark.length, end)) }, next: end + mark.length }
  }
  return null
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = (): void => {
    if (buf !== '') out.push({ kind: 'text', text: buf })
    buf = ''
  }

  let i = 0
  while (i < src.length) {
    const m = matchAt(src, i)
    if (m) {
      flush()
      out.push(m.node)
      i = m.next
      continue
    }
    buf += src[i]
    i++
  }
  flush()
  return out
}

// ── 塊 ────────────────────────────────────────────────

const BULLET = /^(\s*)([-*+])\s+(.*)$/
const NUMBER = /^(\s*)(\d+)[.)]\s+(.*)$/
const HEADING = /^(#{1,6})\s+(.*)$/
const FENCE = /^\s*```(\S*)\s*$/
const HR = /^\s*([-*_])\s*(\1\s*){2,}$/
const QUOTE = /^\s*>\s?(.*)$/
const ROW = /^\s*\|(.+)\|\s*$/
const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

const cells = (line: string): string[] =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())

const alignOf = (c: string): 'left' | 'center' | 'right' =>
  c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'

export function parseMarkdown(src: string): Node[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Node[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') { i++; continue }

    // ``` で囲まれたコード。**閉じていなくても、そこまでを出す**（逐次描画の途中）
    const fence = FENCE.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++])
      if (i < lines.length) i++ // 閉じの ```
      out.push({ kind: 'code', lang: fence[1] || null, text: body.join('\n') })
      continue
    }

    if (HR.test(line)) { out.push({ kind: 'hr' }); i++; continue }

    const h = HEADING.exec(line)
    if (h) {
      out.push({ kind: 'heading', level: h[1].length, children: parseInline(h[2]) })
      i++
      continue
    }

    // 表。**2 行目が区切りでなければ表ではない**（ただの | を含む文）
    if (ROW.test(line) && i + 1 < lines.length && SEP.test(lines[i + 1])) {
      const header = cells(line).map(parseInline)
      const align = cells(lines[i + 1]).map(alignOf)
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && ROW.test(lines[i])) rows.push(cells(lines[i++]).map(parseInline))
      out.push({ kind: 'table', header, rows, align })
      continue
    }

    const q = QUOTE.exec(line)
    if (q) {
      const body: string[] = []
      while (i < lines.length) {
        const m = QUOTE.exec(lines[i])
        if (!m) break
        body.push(m[1])
        i++
      }
      out.push({ kind: 'quote', children: parseMarkdown(body.join('\n')) })
      continue
    }

    if (BULLET.test(line) || NUMBER.test(line)) {
      const [list, next] = parseList(lines, i)
      out.push(list)
      i = next
      continue
    }

    // 段落。空行か、別の塊が始まるまで
    const body: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i])) body.push(lines[i++])
    out.push({ kind: 'p', children: parseInline(body.join('\n')) })
  }
  return out
}

const startsBlock = (line: string): boolean =>
  FENCE.test(line) || HEADING.test(line) || HR.test(line) ||
  QUOTE.test(line) || BULLET.test(line) || NUMBER.test(line)

function parseList(lines: string[], from: number): [Node, number] {
  const first = BULLET.exec(lines[from]) ?? NUMBER.exec(lines[from])!
  const ordered = BULLET.exec(lines[from]) === null
  const indent = first[1].length
  const items: ListItem[] = []
  let i = from

  while (i < lines.length) {
    const m = BULLET.exec(lines[i]) ?? NUMBER.exec(lines[i])
    if (!m || m[1].length !== indent) break
    // 印の種類が変わったら別の一覧
    if ((BULLET.exec(lines[i]) === null) !== ordered) break
    i++

    // 続きの行。**より深い箇条書きは入れ子**、それ以外は同じ項目の続き
    const cont: string[] = [m[3]]
    let sub: Node | null = null
    while (i < lines.length) {
      const deeper = BULLET.exec(lines[i]) ?? NUMBER.exec(lines[i])
      if (deeper && deeper[1].length > indent) {
        const [inner, next] = parseList(lines, i)
        sub = inner
        i = next
        continue
      }
      if (deeper || lines[i].trim() === '' || startsBlock(lines[i])) break
      cont.push(lines[i].trim())
      i++
    }
    items.push({ children: parseInline(cont.join('\n')), sub })
  }
  return [{ kind: 'list', ordered, start: ordered ? Number(first[2]) : 1, items }, i]
}
