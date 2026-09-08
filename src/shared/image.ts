/**
 * 人が貼った画像。
 *
 * **保存層は持たない。** 送ったものは会話の記録に入るので、
 * 別に貯めると会話と食い違う（`shared/touched.ts` と同じ理由）。
 * ここにあるのは「貼られたものを送れる形にする」ところまでである。
 */
export interface Attachment {
  /** `image/png` など。SDK が受ける形に限る */
  mediaType: string
  /** base64。`data:` の頭は含めない */
  data: string
  /** 画面に出す名前。クリップボードからなら空 */
  name: string
}

/** SDK が受ける画像。**ここに無いものは送らない**（送ると呼び出しごと失敗する） */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

/** 1 枚の上限。超えると API 側で落ちるので、送る前に断る */
export const MAX_BYTES = 5 * 1024 * 1024

export function isSupported(mediaType: string): boolean {
  return (IMAGE_TYPES as readonly string[]).includes(mediaType)
}

/** base64 の長さから元のバイト数を出す（復号せずに測る） */
export function byteLength(base64: string): number {
  const pad = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - pad
}

/**
 * 送ってよいかを決め、駄目な理由を日本語で返す。
 * **黙って落とさない** —— 貼った本人には「貼ったのに送られない」としか分からない。
 */
export function rejectReason(a: Attachment): string | null {
  if (!isSupported(a.mediaType)) {
    return `${a.mediaType} は送れません（png / jpeg / gif / webp）`
  }
  if (a.data === '') return '中身が空です'
  const bytes = byteLength(a.data)
  if (bytes > MAX_BYTES) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB は大きすぎます（上限 5MB）`
  }
  return null
}

/** `data:image/png;base64,xxx` を分解する。形が違えば null */
export function fromDataUrl(url: string, name = ''): Attachment | null {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(url)
  if (!m) return null
  return { mediaType: m[1], data: m[2], name }
}

export function toDataUrl(a: Attachment): string {
  return `data:${a.mediaType};base64,${a.data}`
}
