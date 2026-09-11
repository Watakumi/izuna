import { useEffect, useState } from 'react'
import { isMarkdown } from '../../../shared/readfile'
import { mentionFile, mentionLines, relativeTo } from '../../../shared/mention'
import { C, F, MONO, S, ellipsis } from '../theme'
import { Button, Faint, Loading } from './ui'
import { Markdown } from './Markdown'

/**
 * ファイルを窓の中で読む（§34）。**読むだけ。編集はしない**（docs/GOAL.md）。
 *
 * 直すのはエージェントで、人は**指して頼む** —— 行を選んで「この行について」を押すと、
 * 入力欄に `src/x.ts:12-20 について: ` が入る。送るのは人が釦を押したとき（規則 1）。
 *
 * markdown は木で描く（§25）。行を指したいときは「字で見る」に切り替える ——
 * 木のままでは、どの行かを言えない。
 */
export function FileView({
  cwd,
  path,
  onAsk,
  onClose
}: {
  cwd: string
  path: string
  /** 入力欄に足す文（`shared/mention.ts`）。送りはしない */
  onAsk: (mention: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [state, setState] = useState<
    { text: string; truncated: boolean; bytes: number } | { error: string } | null
  >(null)
  const [source, setSource] = useState(!isMarkdown(path))
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)

  // **path ごとに作り直す**（親が key を渡す）ので、ここで初期値に戻す必要は無い。
  // effect の中で同期に setState すると、描画が連鎖する（react-hooks/set-state-in-effect）
  useEffect(() => {
    let alive = true
    window.izuna
      .readFile(cwd, path)
      .then((r) => {
        if (alive) setState(r)
      })
      .catch((e: unknown) => {
        if (alive) setState({ error: String(e).replace(/^Error:\s*/, '') })
      })
    return () => {
      alive = false
    }
  }, [cwd, path])

  const lines = state && 'text' in state ? state.text.split('\n') : []
  const picked = from !== null

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
        <span style={{ font: `${F.small}px ${MONO}`, color: C.ink2, ...ellipsis }} title={path}>
          {relativeTo(cwd, path)}
        </span>
        {state && 'truncated' in state && state.truncated && (
          <span style={{ fontSize: F.micro, color: C.amber, flexShrink: 0 }}>頭だけ</span>
        )}
        <div style={{ flexGrow: 1 }} />
        {picked && (
          <Button
            size="sm"
            kind="primary"
            onClick={() => onAsk(mentionLines(cwd, path, from, to ?? from))}
          >
            {from === (to ?? from) ? `${from} 行目について` : `${from}-${to} 行について`}
          </Button>
        )}
        {!picked && (
          <Button size="sm" onClick={() => onAsk(mentionFile(cwd, path))}>
            このファイルについて
          </Button>
        )}
        {isMarkdown(path) && state && 'text' in state && (
          <Button size="sm" onClick={() => setSource((v) => !v)}>
            {source ? '木で見る' : '字で見る'}
          </Button>
        )}
        <Button size="sm" onClick={onClose}>
          閉じる
        </Button>
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, overflow: 'auto', background: C.code }}>
        {state === null && (
          <div style={{ padding: S.lg }}>
            <Loading />
          </div>
        )}
        {state && 'error' in state && (
          <div style={{ padding: S.lg }}>
            <span style={{ fontSize: F.small, color: C.red }}>{state.error}</span>
          </div>
        )}
        {state && 'text' in state && !source && (
          <div style={{ padding: S.lg, background: C.bg }}>
            <Markdown text={state.text} />
          </div>
        )}
        {state && 'text' in state && source && (
          <div style={{ padding: `${S.md}px 0` }}>
            {lines.map((l, i) => {
              const n = i + 1
              const inRange = from !== null && n >= from && n <= (to ?? from)
              return (
                <div
                  key={n}
                  data-line={n}
                  onClick={(e) => {
                    // 続けて押すと範囲。shift でも同じ（片手で選べる）
                    if (picked && (e.shiftKey || n !== from)) setTo(n)
                    else {
                      setFrom(n)
                      setTo(null)
                    }
                  }}
                  style={{
                    display: 'flex',
                    gap: S.md,
                    padding: `0 ${S.lg}px`,
                    font: `11.5px/1.75 ${MONO}`,
                    whiteSpace: 'pre',
                    cursor: 'pointer',
                    background: inRange ? C.amberBg : 'transparent'
                  }}
                >
                  <span
                    style={{
                      color: inRange ? C.amber : C.faint,
                      minWidth: '3.5em',
                      textAlign: 'right',
                      flexShrink: 0,
                      userSelect: 'none'
                    }}
                  >
                    {n}
                  </span>
                  <span style={{ color: C.ink2 }}>{l}</span>
                </div>
              )
            })}
            {state.truncated && (
              <div style={{ padding: `${S.md}px ${S.lg}px` }}>
                <Faint>上限まで読んだところで切りました（{state.bytes} バイト）</Faint>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
