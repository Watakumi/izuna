/**
 * 一度読んだものを覚えておく控え。
 *
 * タブを行き来するたびに画面が作り直され、**そのたびに「読んでいます…」**が
 * 出ていた。中身はほとんど変わらないのに、毎回 git と API を待たせるのは筋が悪い。
 *
 * **覚えたものを先に出し、裏で取り直す。** 古い値が一瞬見えるのは
 * 「読んでいます…」より害が小さい —— それは嘘ではなく、**少し前の事実**である。
 *
 * **画面を閉じたら消える**（module の寿命）。ディスクには置かない ——
 * 残すと、次に開いたときに存在しない remote を「ある」と言いかねない。
 *
 * 3 つの画面が同じことを別々に書いていたので、1 つにまとめた（§17 と同じ理由）。
 */
export interface Cache<T> {
  get(key: string): T | null
  set(key: string, value: T): void
}

export function makeCache<T>(): Cache<T> {
  const store = new Map<string, T>()
  return {
    get: (key) => store.get(key) ?? null,
    set: (key, value) => {
      store.set(key, value)
    }
  }
}
