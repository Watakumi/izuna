import { fromDataUrl, rejectReason, toDataUrl, type Attachment } from '../../../shared/image'
import { C, F, MONO, R, S } from '../theme'

/**
 * 貼った画像の控え。
 *
 * **断った理由を必ず出す。** 黙って落とすと、貼った本人には
 * 「貼ったのに送られない」としか分からない。
 */
export function Attachments({ items, rejected, onRemove }: {
  items: Attachment[]
  rejected: string[]
  onRemove: (at: number) => void
}): React.JSX.Element | null {
  if (items.length === 0 && rejected.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xs, padding: `${S.sm}px ${S.md}px` }}>
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
          {items.map((a, i) => (
            <button key={i} onClick={() => onRemove(i)} title={a.name || '外す'}
              style={{ padding: 0, border: `1px solid ${C.line2}`, borderRadius: R.sm,
                background: C.raised, cursor: 'pointer', lineHeight: 0 }}>
              <img src={toDataUrl(a)} alt={a.name}
                style={{ height: 44, width: 'auto', maxWidth: 88, objectFit: 'cover',
                  borderRadius: R.sm, display: 'block' }} />
            </button>
          ))}
        </div>
      )}
      {rejected.map((r, i) => (
        <span key={i} style={{ font: `${F.micro}px ${MONO}`, color: C.amber }}>{r}</span>
      ))}
    </div>
  )
}

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
