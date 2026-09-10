import { useEffect, useRef, useState } from 'react'
import { FitAddon, Terminal, init } from 'ghostty-web'
import { F, C, MONO, ellipsis, resolve, resolveMono } from '../theme'

/**
 * worktree のシェル（段6）。
 *
 * **描画は `ghostty-web`** —— libghostty-vt の公式 WASM ビルドで、
 * 本物の Ghostty と同じ VT 実装。当初の企画趣旨（libghostty を使う）は
 * ここで果たされる（CLAUDE.md §2）。
 *
 * WASM は base64 で ESM に埋め込まれているので、`.wasm` を別途配る必要がない
 * （Nimbalyst は `ghostty-vt.wasm` を同梱している）。`init()` を呼ぶだけ。
 *
 * main 側（`main/terminal.ts`）は PTY を持つだけで、バイト列を解釈しない。
 */

/** WASM の読み込みは 1 回でよい。開くたびに待たせない */
let ready: Promise<void> | null = null
const ensureReady = (): Promise<void> => (ready ??= init())

export function TerminalPane({
  cwd,
  onClose
}: {
  cwd: string
  onClose: () => void
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [exited, setExited] = useState<number | null>(null)

  useEffect(() => {
    let disposed = false
    let term: Terminal | undefined
    let fit: FitAddon | undefined
    let ptyId: string | null = null
    let unsubscribe: (() => void) | undefined
    let observer: ResizeObserver | undefined

    const start = async (): Promise<void> => {
      try {
        await ensureReady()
        if (disposed || !host.current) return

        // **利用者の Ghostty の配色をそのまま渡す。** 端末の色は 16 色が
        // 仕様として決まっているので、アプリ側のように混ぜて作る必要が無い
        const g = await window.izuna.ghosttySkin().catch(() => null)

        term = new Terminal({
          fontSize: g?.terminalFontSize ?? F.body,
          // canvas は var() を解けない。**必ず解いてから渡す**（theme.ts の註）
          fontFamily: resolveMono(),
          cursorBlink: true,
          scrollback: 5000,
          theme: g?.terminal ?? {
            background: resolve('code'),
            foreground: resolve('ink2'),
            cursor: resolve('amber'),
            selectionBackground: resolve('raised')
          }
        })
        fit = new FitAddon()
        term.loadAddon(fit)
        term.open(host.current)
        fit.fit()

        ptyId = await window.izuna.openTerminal({ cwd, cols: term.cols, rows: term.rows })
        if (disposed) {
          void window.izuna.closeTerminal(ptyId)
          return
        }

        // PTY → 画面。**解釈しない。**ghostty-web が VT を読む
        unsubscribe = window.izuna.onTerminal((event) => {
          if (event.id !== ptyId) return
          if (event.kind === 'data') term?.write(event.data)
          else setExited(event.code)
        })

        // 画面 → PTY
        term.onData((data) => {
          if (ptyId) void window.izuna.writeTerminal(ptyId, data)
        })

        observer = new ResizeObserver(() => {
          if (!term || !fit || !ptyId) return
          fit.fit()
          void window.izuna.resizeTerminal(ptyId, term.cols, term.rows)
        })
        observer.observe(host.current)
      } catch (e) {
        if (!disposed) setError(String(e).replace(/^Error:\s*/, ''))
      }
    }

    void start()

    return () => {
      disposed = true
      observer?.disconnect()
      unsubscribe?.()
      if (ptyId) void window.izuna.closeTerminal(ptyId)
      term?.dispose()
    }
  }, [cwd])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.code }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderBottom: `1px solid ${C.line}`,
          background: C.panel,
          flexShrink: 0
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke={C.dim2}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 17l6-6-6-6M12 19h8" />
        </svg>
        <span
          style={{ fontSize: F.small, letterSpacing: '0.06em', color: C.dim2, fontWeight: 600 }}
        >
          ターミナル
        </span>
        <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, flexGrow: 1, ...ellipsis }}>
          {cwd}
        </span>
        {exited !== null && (
          <span style={{ fontSize: F.micro, color: exited === 0 ? C.dim2 : C.red }}>
            終了 ({exited})
          </span>
        )}
        <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint }}>ghostty-web</span>
        <span
          onClick={onClose}
          title="閉じる"
          style={{ color: C.faint, fontSize: F.title, lineHeight: 1, cursor: 'pointer' }}
        >
          ×
        </span>
      </div>

      {error ? (
        <div style={{ padding: '16px 16px', fontSize: F.body, color: C.red, lineHeight: 1.7 }}>
          {error}
        </div>
      ) : (
        <div ref={host} style={{ flexGrow: 1, minHeight: 0, padding: 6 }} />
      )}
    </div>
  )
}
