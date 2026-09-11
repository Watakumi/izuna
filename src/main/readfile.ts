import { open, stat } from 'node:fs/promises'
import { MAX_READ_BYTES, looksText, readableUnder } from '../shared/readfile'

/**
 * 中で読むためにファイルを読む（§34）。**読むだけ。書く口は作らない。**
 *
 * 関所は `shared/readfile.ts`。作業ディレクトリの外は読まない ——
 * 会話に出たパスをそのまま渡す経路なので、エージェントが書いたパスが混ざりうる（§26 の敵）。
 */
export interface FileText {
  text: string
  /** 上限で切ったか */
  truncated: boolean
  bytes: number
}

export async function readRepoFile(roots: string[], path: string): Promise<FileText> {
  if (!readableUnder(roots, path)) {
    throw new Error('作業ディレクトリの外は読みません')
  }
  const info = await stat(path)
  if (!info.isFile()) throw new Error('ファイルではありません')

  const fh = await open(path, 'r')
  try {
    const size = info.size
    const take = Math.min(size, MAX_READ_BYTES)
    const buf = new Uint8Array(take)
    await fh.read(buf, 0, take, 0)
    // 頭だけ見れば足りる。全部走査しても答えは変わらない
    if (!looksText(buf.subarray(0, Math.min(take, 4096)))) {
      throw new Error('字として読めません（画像や実行ファイル）')
    }
    return {
      text: new TextDecoder().decode(buf),
      truncated: size > take,
      bytes: size
    }
  } finally {
    await fh.close()
  }
}
