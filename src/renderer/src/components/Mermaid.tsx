import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { C, F, MONO, R, resolve, resolveMono, S } from '../theme'
import { Button } from './ui'

/**
 * ```mermaid を図として出す。
 *
 * **色は `resolve()` を通してから渡す**（§21）。`theme.ts` の `C` は
 * CSS 変数を包んだ形をしていて、**CSS の中でしか意味を持たない**。
 * mermaid は SVG の属性に直接書くので、変数のまま渡すと黒い図になる。
 * 端末を一度これで壊しているので、ここでは最初から解いて渡す。
 *
 * **図が描けなくても本文は失う。** 描けなければ元の字を出す ——
 * 図にならなかったからといって、書いてあったことまで消してはいけない。
 */

let ready = false

function init(): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    fontFamily: resolveMono(),
    theme: 'base',
    themeVariables: {
      background: resolve('panel'),
      primaryColor: resolve('raised'),
      primaryTextColor: resolve('ink'),
      primaryBorderColor: resolve('line2'),
      secondaryColor: resolve('surface'),
      tertiaryColor: resolve('panel'),
      lineColor: resolve('dim2'),
      textColor: resolve('ink2'),
      mainBkg: resolve('raised'),
      nodeBorder: resolve('line2'),
      clusterBkg: resolve('panel'),
      clusterBorder: resolve('line'),
      titleColor: resolve('ink'),
      edgeLabelBackground: resolve('panel')
    }
  })
  ready = true
}

let seq = 0

export function Mermaid({ text }: { text: string }): React.JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [source, setSource] = useState(false)
  const id = useRef(`m${(seq += 1)}`)

  useEffect(() => {
    let live = true
    if (!ready) init()
    mermaid.render(id.current, text)
      .then((r) => { if (live) { setSvg(r.svg); setFailed(null) } })
      .catch((e: unknown) => { if (live) setFailed(String(e).replace(/^Error:\s*/, '').split('\n')[0]) })
    return () => { live = false }
  }, [text])

  // 描けなかったときは**字をそのまま出す**。図にならなかったことは下に書く
  if (failed !== null || source || svg === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: S.xs, margin: '8px 0' }}>
        <pre style={{ margin: 0, padding: S.md, background: C.raised, borderRadius: R.md,
          border: `1px solid ${C.line}`, overflowX: 'auto', font: `${F.small}px ${MONO}`,
          color: C.ink2 }}>{text}</pre>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.sm }}>
          {failed !== null && (
            <span style={{ font: `${F.micro}px ${MONO}`, color: C.amber }}>図にできません: {failed}</span>
          )}
          <div style={{ flexGrow: 1 }} />
          {failed === null && svg !== null && (
            <Button size="sm" onClick={() => setSource(false)}>図で見る</Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xs, margin: '8px 0' }}>
      <div style={{ padding: S.md, background: C.panel, borderRadius: R.md,
        border: `1px solid ${C.line}`, overflowX: 'auto' }}
        dangerouslySetInnerHTML={{ __html: svg }} />
      <div style={{ display: 'flex' }}>
        <div style={{ flexGrow: 1 }} />
        <Button size="sm" onClick={() => setSource(true)}>字で見る</Button>
      </div>
    </div>
  )
}
