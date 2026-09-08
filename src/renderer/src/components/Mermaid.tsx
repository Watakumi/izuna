import { useEffect, useId, useState } from 'react'
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
 * **図が描けなくても本文は失わない。** 描けなければ元の字を出す ——
 * 図にならなかったからといって、書いてあったことまで消してはいけない。
 *
 * **ここがアプリで唯一の HTML 注入口である。** `shared/markdown.ts` は木を返して
 * HTML を作らないが、mermaid は SVG の文字列しか返さない。`securityLevel: 'strict'`
 * で mermaid 側が消毒し、`test/surface.test.ts` が「注入口がここ以外に無いこと」を
 * 見張る。renderer には `window.izuna.openTerminal` があるので、ここが破られれば
 * ユーザ権限のコード実行になる（§26）。
 */

type MermaidModule = typeof import('mermaid')['default']
let loaded: Promise<MermaidModule> | null = null

/**
 * **図が出るまで読まない。** mermaid は展開で 83MB、束ねても本体だけで 1MB を超える。
 * 先頭で import すると、図の無い会話でも起動時に読まれる（§27）。
 */
function load(): Promise<MermaidModule> {
  loaded ??= import('mermaid').then((m) => { init(m.default); return m.default })
  return loaded
}

function init(mermaid: MermaidModule): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    /**
     * **失敗した図を body に描かせない。** これが無いと、構文エラーのとき
     * mermaid は「Syntax error in text」の図を一時要素に描いてから例外を投げ、
     * 後始末（`removeTempElements`）はその後ろにあるので呼ばれない。
     * 逐次描画では途中の文字列が毎回失敗するので、その図が画面の末尾に残る
     * （`mermaid.core.mjs` で確認。2026-09-08）
     */
    suppressErrorRendering: true,
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
}

/** 本文が変わらなくなってから描くまでの間。短すぎると途中の失敗を見せる */
const SETTLE_MS = 300

export function Mermaid({ text }: { text: string }): React.JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [source, setSource] = useState(false)
  // mermaid は id を CSS セレクタに使う。`useId` の `:` は落とし、`m` で始める（撮影の門が探す形）
  const id = { current: 'm' + useId().replace(/\W/g, '') }

  useEffect(() => {
    let live = true
    /**
     * **落ち着いてから描く。** 逐次描画では 1 チャンクごとに本文が変わる。
     * そのたびに描くと、途中の文字列で失敗し続けたうえに CPU を食う。
     * 変わらなくなって少し待ってから 1 回描く。
     */
    const timer = setTimeout(() => {
      load()
        .then((mermaid) => mermaid.render(id.current, text))
        .then((r) => { if (live) { setSvg(r.svg); setFailed(null) } })
        .catch((e: unknown) => { if (live) setFailed(String(e).replace(/^Error:\s*/, '').split('\n')[0]) })
    }, SETTLE_MS)
    return () => { live = false; clearTimeout(timer) }
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
