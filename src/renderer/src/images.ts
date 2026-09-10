import { fromDataUrl, rejectReason, type Attachment } from '../../shared/image'

/**
 * 貼られた画像を読む。部品（`components/Attachments.tsx`）から分けたのは、
 * コンポーネント以外を同じファイルから export すると Fast Refresh が効かなくなるため（§17）。
 */
/**
 * クリップボードと drop から画像を取り出す。
 * **読めなかったものは理由にして返す** —— 数だけ合わないのが一番分からない。
 */
export async function collectImages(
  files: readonly File[]
): Promise<{ ok: Attachment[]; bad: string[] }> {
  const ok: Attachment[] = []
  const bad: string[] = []
  for (const file of files) {
    const url = await new Promise<string>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => resolve('')
      r.readAsDataURL(file)
    })
    const a = fromDataUrl(url, file.name)
    if (a === null) {
      bad.push(`${file.name || '画像'} を読めませんでした`)
      continue
    }
    const why = rejectReason(a)
    if (why !== null) bad.push(`${file.name || '画像'}: ${why}`)
    else ok.push(a)
  }
  return { ok, bad }
}
