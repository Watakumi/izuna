/**
 * **鍵を API に出さないための覆い**（利用者の判断、2026-09-14。security.md §36）。
 *
 * `redact.ts` と根は同じだが、目的が違う。あちらは**人に見せる文面**から伏せるだけで戻せない。
 * こちらは**モデルに渡す前に伏せ、モデルが書き戻したら実値に戻す**ので、往復する。
 *
 * ```
 *   ツールの結果 ──mask──▶ ⟦IZUNA_SECRET_1⟧ ──▶ モデル
 *   実行するもの ◀─unmask── ⟦IZUNA_SECRET_1⟧ ◀── モデル
 * ```
 *
 * **経路の中で同期に返しきる**（2026-09-14 の実測）。SDK の註に「非同期の hook の返事は、
 * 結果が固まったあとに届くので無視される」とあるので、ここに外の道具（ollama など）を
 * 呼ぶ余地は無い。決定的な置換だけを置く。
 *
 * 対応表はこの覆い 1 つ分の寿命しか持たない。**ディスクに書かない。**
 *
 * 純粋関数（プロセスを知らない。§4 の原則）。
 */

/** 札の形。番号は見つけた順 */
export const MASK_PREFIX = '⟦IZUNA_SECRET_'
export const MASK_SUFFIX = '⟧'
const MARK = /⟦IZUNA_SECRET_(\d+)⟧/g
/** 掴んだもの**全体**が札か（二重に覆わないための判定） */
const WHOLE_MARK = /^⟦IZUNA_SECRET_\d+⟧$/

/**
 * 捕まえる形。**値そのものを捕まえる**（戻せる必要があるため）。
 *
 * 広げすぎない —— 全部を伏せるとモデルが仕事をできなくなる。狭すぎても漏れるので、
 * 足したものは `test/mask.test.ts` に実例を置く。
 */
const PATTERNS: RegExp[] = [
  // Anthropic / GitHub
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{16,}/g,
  // Google（利用者が名指しした gcloud。鍵と短命トークンの両方）
  /AIza[0-9A-Za-z_-]{30,}/g,
  /ya29\.[0-9A-Za-z_-]{20,}/g,
  // OpenAI 風の汎用（sk- で始まる長い英数）
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  // JWT
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // 秘密鍵の PEM
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // URL の userinfo（値だけ）
  /(?<=https?:\/\/[^/\s:@]+:)[^/\s@]{4,}(?=@)/g,
  // .env / シェルの代入。**値だけ**を捕まえる（鍵の名前は残す —— 何が伏せられたか読めるように）
  /(?<=^[ \t]*(?:export[ \t]+)?[A-Za-z_]{0,40}(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PASSWD)[A-Za-z_]{0,20}[ \t]*[=:][ \t]*)["']?[^\s"'#]{8,}/gim
]

export interface Masker {
  /** 文字列から鍵を札に替える */
  maskText(text: string): string
  /** ツールの結果ごと替える（文字列でも入れ子でも） */
  mask(value: unknown): unknown
  /** 札を実値に戻す */
  unmaskText(text: string): string
  /** ツールの入力ごと戻す */
  unmask(value: unknown): unknown
  /** 覆っている数。画面に出すのはこれだけ（実値は出さない） */
  readonly size: number
}

/**
 * 覆いを 1 つ作る。**セッションに 1 つ。**
 *
 * 同じ実値には同じ札を返す —— 番号が毎回変わると、モデルが前に見た札と
 * 同じものだと分からなくなる。
 */
export function createMasker(): Masker {
  const toMark = new Map<string, string>()
  const toValue = new Map<string, string>()

  const markFor = (value: string): string => {
    const had = toMark.get(value)
    if (had) return had
    const mark = `${MASK_PREFIX}${toMark.size + 1}${MASK_SUFFIX}`
    toMark.set(value, mark)
    toValue.set(mark, value)
    return mark
  }

  /**
   * **既に札になっているものを、もう一度覆わない。**
   *
   * 型は順に当てるので、先に付いた札を後の型が掴むことがある（`ghp_…` を覆ったあと、
   * URL の userinfo の型がその札を値として掴んだ）。二重に覆うと、戻すのに 2 回要る。
   * 実値と札の対応が 1 対 1 でなくなるので、掴んだものが札なら触らない。
   */
  const maskText = (text: string): string =>
    PATTERNS.reduce((t, re) => t.replace(re, (m) => (WHOLE_MARK.test(m) ? m : markFor(m))), text)

  const unmaskText = (text: string): string => text.replace(MARK, (m) => toValue.get(m) ?? m)

  /**
   * 入れ子は JSON を経由して替える。**形を変えない** ——
   * ツールの結果は形のまま返さないとモデルが読めない。
   * JSON にできないものは触らない（触れないものを触ったふりをしない）。
   */
  const through = (value: unknown, f: (s: string) => string): unknown => {
    if (typeof value === 'string') return f(value)
    if (value === null || typeof value !== 'object') return value
    try {
      const json = JSON.stringify(value)
      if (json === undefined) return value
      const next = f(json)
      return next === json ? value : (JSON.parse(next) as unknown)
    } catch {
      return value
    }
  }

  return {
    maskText,
    unmaskText,
    mask: (value) => through(value, maskText),
    unmask: (value) => through(value, unmaskText),
    get size() {
      return toMark.size
    }
  }
}

/**
 * 札が混ざっているか（戻す必要があるかの判定）。
 *
 * **`g` 付きの正規表現を `test` に使わない** —— `lastIndex` が残るので、
 * 同じ文字列を 2 回聞くと 2 回目が false になる。判定用は別に持つ。
 */
const HAS_MARK = /⟦IZUNA_SECRET_\d+⟧/
export function hasMark(value: unknown): boolean {
  if (typeof value === 'string') return HAS_MARK.test(value)
  if (value === null || typeof value !== 'object') return false
  try {
    return HAS_MARK.test(JSON.stringify(value) ?? '')
  } catch {
    return false
  }
}
