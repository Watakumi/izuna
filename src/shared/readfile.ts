/**
 * 中で読むファイルの関所と上限（§34）。
 *
 * **Izuna は読む道具**（docs/GOAL.md「やらないこと」の WYSIWYG エディタ）。中で開くのは読むためだけで、
 * 書き換えはエージェントがやる。だから口も「読む」しか持たない。
 *
 * 判定だけの純粋関数（§4）。実際に読むのは `main/readfile.ts`。
 */

/** これを超えたら頭だけ返す。読むための窓であって、全文を運ぶ口ではない */
export const MAX_READ_BYTES = 512 * 1024

/**
 * 読んでよい場所か。**作業ディレクトリの中だけ。**
 *
 * `..` で外に出る経路を閉じる。渡された路を正規化してから、根の下にあるかを見る ——
 * 文字列の前方一致だけだと `/w` が `/work` に当たる（`/w` + `/` で比べる）。
 */
export function readableUnder(roots: string[], path: string): boolean {
  if (!path.startsWith('/')) return false
  const here = normalize(path)
  return roots.some((root) => {
    const base = normalize(root)
    return here === base || here.startsWith(base === '/' ? '/' : `${base}/`)
  })
}

/** `.` と `..` を畳み、末尾の `/` を落とす。記号の解決はしない（main が実体で見る） */
export function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

/**
 * 字として出してよいか。**NUL があれば出さない。**
 *
 * 画像や実行ファイルを等幅で描くと画面が壊れる。頭の一部だけ見れば足りる
 * （UTF-8 の本文に NUL は出ない）。
 */
export function looksText(head: Uint8Array): boolean {
  return !head.includes(0)
}

/** 中身の出し方。markdown だけ木で描き、それ以外は等幅で行番号を振る（§25 の例外を増やさない） */
export function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path)
}
