import { access, rename, rm, writeFile } from 'node:fs/promises'

/**
 * ファイルの小さな道具。`team.ts` / `repos.ts` / `meeting.ts` に同じ `exists` が、
 * `loop.ts` / `wakeup.ts` / `meeting.ts` に同じ「一時ファイルに書いて置き換える」があった
 * （2026-10-07 のレビューで指摘。§27 の重複の整理）。
 */

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

let seq = 0

/**
 * 書き換え中に落ちても壊さない。**一時ファイルに書いてから置き換える。**
 *
 * **一時ファイルの名前は毎回変える。** `${path}.tmp` に固定すると、2 つの書き手が同時に書いたとき
 * 互いの一時ファイルを置き換え、片方の `rename` が ENOENT で落ちるか、古いほうが最後に残る
 * （会議の控えで指摘された。`loop.ts` と `wakeup.ts` も同じ形だった）。
 */
export async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${++seq}.tmp`
  try {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, path)
  } catch (err) {
    // 名前が毎回違うので、失敗した一時ファイルを残すと溜まる。消してから投げ直す
    await rm(tmp, { force: true })
    throw err
  }
}
