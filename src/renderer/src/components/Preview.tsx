import { useEffect, useRef } from 'react'
import { C, F, MONO, S, ellipsis } from '../theme'
import { Button } from './ui'

/**
 * 頁を窓の中で見る枠（§32）。PR の頁を Izuna から出ずに読む。
 *
 * 中身は main の `WebContentsView` が renderer の上に重ねて描く。ここは**場所を測って送るだけ**で、
 * 頁の中身には触れない。枠が動いたり大きさが変わったりしたら送り直す ——
 * 右のパネルの幅はタブで変わるので、大きさだけでなく位置も見る。
 * 閉じたら main に消してもらう（重なったまま残ると、下の会話が押せない）。
 */
/** GitHub 以外（＝Forgejo）。private の頁は未ログインだと 404 が出る */
const isForge = (url: string): boolean => {
  try {
    return !/(^|\.)github\.com$/.test(new URL(url).host)
  } catch {
    return false
  }
}

export function Preview({ url, onClose }: { url: string; onClose: () => void }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    let last = ''
    const measure = (): { x: number; y: number; width: number; height: number } => {
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, width: r.width, height: r.height }
    }
    const send = (): void => {
      const r = measure()
      const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`
      if (key === last) return
      last = key
      void window.izuna.previewBounds(r)
    }
    void window.izuna
      .previewOpen(url, measure())
      .then(() => {
        last = ''
        send()
      })
      .catch(() => undefined)
    // 大きさは ResizeObserver、位置は間隔で見る（位置の変化を知らせる口はブラウザに無い）
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(send)
    ro?.observe(el)
    const timer = setInterval(send, 250)
    window.addEventListener('resize', send)
    return () => {
      ro?.disconnect()
      clearInterval(timer)
      window.removeEventListener('resize', send)
      void window.izuna.previewClose()
    }
  }, [url])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: S.md,
          padding: `${S.sm}px ${S.lg}px`,
          background: C.panel,
          borderBottom: `1px solid ${C.line}`,
          flexShrink: 0
        }}
      >
        <span style={{ font: `${F.small}px ${MONO}`, color: C.dim2, ...ellipsis }} title={url}>
          {url}
        </span>
        <div style={{ flexGrow: 1 }} />
        {/* 外のブラウザで開く。リンクは main の門が既定のブラウザへ逃がす（shared/links.ts） */}
        <a
          href={url}
          style={{
            font: `${F.small}px ${MONO}`,
            color: C.dim2,
            textDecoration: 'none',
            flexShrink: 0
          }}
        >
          外で開く
        </a>
        <Button size="sm" onClick={onClose}>
          閉じる
        </Button>
      </div>
      {isForge(url) && (
        <div
          style={{
            padding: `${S.xs}px ${S.lg}px`,
            fontSize: F.micro,
            color: C.faint,
            background: C.panel,
            flexShrink: 0
          }}
        >
          private の頁が 404 なら、この中で一度ログインしてください。次からはそのまま開きます
        </div>
      )}
      {/* ここに main が頁を重ねる。中身は描かない */}
      <div ref={box} style={{ flexGrow: 1, minHeight: 0, background: C.code }} />
    </div>
  )
}
