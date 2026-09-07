import { parseInline, parseMarkdown, type Inline, type ListItem, type Node } from '../../../shared/markdown'
import { C, F, MONO, R, S } from '../theme'

/**
 * 会話の本文。解釈は `shared/markdown.ts`（純粋関数）が持つ。
 *
 * **`dangerouslySetInnerHTML` を使わない。** LLM の出力を HTML にすると
 * Electron で script 注入の口になる。木のまま React 要素に組む。
 *
 * リンクは必ず `target="_blank"` にする —— 素の `<a href>` だと
 * **アプリの窓ごと外部サイトに遷移する**。`setWindowOpenHandler` を
 * 通せば既定のブラウザに逃がせる（main 側で `will-navigate` も塞いである）。
 */
export function Markdown({ text }: { text: string }): React.JSX.Element {
  return <Blocks nodes={parseMarkdown(text)} />
}

function Blocks({ nodes }: { nodes: Node[] }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      {nodes.map((n, i) => <Block key={i} node={n} />)}
    </div>
  )
}

function Block({ node }: { node: Node }): React.JSX.Element {
  switch (node.kind) {
    case 'p':
      return <div style={{ lineHeight: 1.8 }}><Spans nodes={node.children} /></div>

    case 'heading': {
      // 見出しは 3 段まで。それ以上は本文と同じ扱いにする（会話に h4 は要らない）
      const size = node.level <= 1 ? F.title : node.level === 2 ? F.base : F.body
      return (
        <div style={{
          fontSize: size, fontWeight: 600, color: C.ink,
          marginTop: S.xs, lineHeight: 1.5
        }}>
          <Spans nodes={node.children} />
        </div>
      )
    }

    case 'code':
      return (
        // 横に長いコードは**この箱の中だけ**で流す。本文ごと横に伸ばさない
        <pre style={{
          margin: 0, padding: S.lg, background: C.bg, border: `1px solid ${C.line}`,
          borderRadius: R.md, overflowX: 'auto', font: `${F.small}px/1.7 ${MONO}`, color: C.ink2
        }}>
          {node.lang && (
            <div style={{ font: `${F.micro}px ${MONO}`, color: C.faint, marginBottom: S.sm }}>{node.lang}</div>
          )}
          <code>{node.text}</code>
        </pre>
      )

    case 'list':
      return <List node={node} />

    case 'quote':
      return (
        <div style={{ borderLeft: `2px solid ${C.line2}`, paddingLeft: S.lg, color: C.dim }}>
          <Blocks nodes={node.children} />
        </div>
      )

    case 'hr':
      return <div style={{ height: 1, background: C.line, margin: `${S.xs}px 0` }} />

    case 'table':
      return <Table node={node} />
  }
}

function List({ node }: { node: Extract<Node, { kind: 'list' }> }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
      {node.items.map((item, i) => <Row key={i} item={item} marker={node.ordered ? `${node.start + i}.` : '·'} />)}
    </div>
  )
}

function Row({ item, marker }: { item: ListItem; marker: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', gap: S.md, lineHeight: 1.8 }}>
      <span style={{ color: C.faint, flexShrink: 0, font: `${F.small}px ${MONO}`, paddingTop: 2 }}>{marker}</span>
      <div style={{ minWidth: 0, flexGrow: 1 }}>
        <Spans nodes={item.children} />
        {item.sub && <div style={{ marginTop: S.sm }}><Block node={item.sub} /></div>}
      </div>
    </div>
  )
}

function Table({ node }: { node: Extract<Node, { kind: 'table' }> }): React.JSX.Element {
  const cell = (i: number): React.CSSProperties => ({
    padding: `${S.sm}px ${S.lg}px`,
    textAlign: node.align[i] ?? 'left',
    borderBottom: `1px solid ${C.line}`,
    verticalAlign: 'top'
  })
  return (
    // 表は**中で横に流す**。本文の幅を押し広げない
    <div style={{ overflowX: 'auto', border: `1px solid ${C.line}`, borderRadius: R.md }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: F.body }}>
        <thead>
          <tr>
            {node.header.map((h, i) => (
              <th key={i} style={{ ...cell(i), color: C.dim2, fontWeight: 600, whiteSpace: 'nowrap' }}>
                <Spans nodes={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.rows.map((row, r) => (
            <tr key={r}>
              {row.map((c, i) => <td key={i} style={cell(i)}><Spans nodes={c} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Spans({ nodes }: { nodes: Inline[] }): React.JSX.Element {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.kind) {
          case 'text':
            // 改行は残す。段落の中の折り返しは書き手の意図であることが多い
            return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{n.text}</span>
          case 'code':
            return (
              <code key={i} style={{
                font: `${F.small}px ${MONO}`, background: C.raised, color: C.ink,
                padding: `1px ${S.xs}px`, borderRadius: R.sm, wordBreak: 'break-all'
              }}>{n.text}</code>
            )
          case 'strong':
            return <strong key={i} style={{ fontWeight: 600, color: C.ink }}><Spans nodes={n.children} /></strong>
          case 'em':
            return <em key={i}><Spans nodes={n.children} /></em>
          case 'strike':
            return <s key={i} style={{ color: C.dim2 }}><Spans nodes={n.children} /></s>
          case 'link':
            return (
              <a key={i} href={n.href} target="_blank" rel="noreferrer"
                style={{ color: C.teal, textDecoration: 'none', borderBottom: `1px solid ${C.line2}` }}>
                <Spans nodes={n.children} />
              </a>
            )
        }
      })}
    </>
  )
}

/** 1 行だけを描く（表の中など、塊にしたくない場所） */
export function MarkdownLine({ text }: { text: string }): React.JSX.Element {
  return <Spans nodes={parseInline(text)} />
}
