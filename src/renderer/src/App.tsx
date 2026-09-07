import { useEffect, useRef, useState } from 'react'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionRequest } from '../../main/claude/session'
import type { SessionId } from '../../shared/ipc'

/**
 * 段1-a の動作確認画面。
 *
 * 目的は**実ウィンドウから claude が起きること**の確認に絞ってある。
 * ログインシェル経由の PATH 解決とキーチェーン読み取りが Finder 起動でも
 * 通るか（CLAUDE.md §9）が、ここで初めて分かる。
 *
 * 会話の描画は段1-c で作り直す。ここでは生のイベントを並べるだけにして、
 * 状態モデル（段1-b）を先回りして作り込まない。
 */

interface Row {
  at: string
  label: string
  detail: string
  tone: 'plain' | 'good' | 'warn' | 'bad'
}

function describe(m: SDKMessage): Row | null {
  const at = new Date().toLocaleTimeString('ja-JP', { hour12: false })
  if (m.type === 'system' && m.subtype === 'init') {
    return { at, label: 'init', tone: 'good',
      detail: `session=${m.session_id.slice(0, 8)} model=${m.model} mode=${m.permissionMode} / ${m.slash_commands.length} コマンド` }
  }
  if (m.type === 'assistant') {
    const parts = m.message.content.map((b) => {
      if (b.type === 'text') return `text: ${b.text.trim().slice(0, 120)}`
      if (b.type === 'thinking') return 'thinking'
      if (b.type === 'tool_use') return `tool_use: ${b.name}`
      return b.type
    })
    return { at, label: 'assistant', detail: parts.join(' / '), tone: 'plain' }
  }
  if (m.type === 'user') {
    const c = m.message.content
    const n = Array.isArray(c) ? c.filter((b) => b.type === 'tool_result').length : 0
    return { at, label: 'user', detail: n ? `tool_result × ${n}` : '（送信の echo）', tone: 'plain' }
  }
  if (m.type === 'result') {
    const cost = 'total_cost_usd' in m ? m.total_cost_usd : undefined
    return { at, label: 'result', tone: m.subtype === 'success' ? 'good' : 'bad',
      detail: `${m.subtype}${cost !== undefined ? ` / $${cost}` : ''}` }
  }
  // stream_event はここでは出さない。数が多く、段1-b で状態モデルが畳む
  if (m.type === 'stream_event') return null
  return { at, label: m.type, detail: 'subtype' in m ? String(m.subtype ?? '') : '', tone: 'plain' }
}

const TONE: Record<Row['tone'], string> = {
  plain: '#9aa2b4', good: '#4fc4b0', warn: '#e8a33d', bad: '#e06c75'
}

function App(): React.JSX.Element {
  const [cwd, setCwd] = useState(() => localStorage.getItem('izuna.cwd') ?? '')
  const [id, setId] = useState<SessionId | null>(null)
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState('Reply with exactly: pong')
  const [rows, setRows] = useState<Row[]>([])
  const [pending, setPending] = useState<PermissionRequest | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const push = (r: Row): void => setRows((prev) => [...prev, r])

  useEffect(() => window.izuna.onEvent((event) => {
    if (event.kind === 'message') {
      const row = describe(event.message)
      if (row) push(row)
    } else if (event.kind === 'permission') {
      setPending(event.request)
      push({ at: new Date().toLocaleTimeString('ja-JP', { hour12: false }),
        label: 'permission', detail: `${event.request.toolName} の承認待ち`, tone: 'warn' })
    } else if (event.kind === 'error') {
      push({ at: new Date().toLocaleTimeString('ja-JP', { hour12: false }),
        label: 'error', detail: event.message, tone: 'bad' })
    } else {
      push({ at: new Date().toLocaleTimeString('ja-JP', { hour12: false }),
        label: 'exit', detail: 'セッションが終了しました', tone: 'warn' })
      setId(null)
    }
  }), [])

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [rows])

  const start = async (): Promise<void> => {
    if (!cwd.trim()) return
    setBusy(true)
    setRows([])
    try {
      localStorage.setItem('izuna.cwd', cwd)
      setId(await window.izuna.start({ cwd: cwd.trim(), model: 'haiku' }))
    } catch (err) {
      push({ at: new Date().toLocaleTimeString('ja-JP', { hour12: false }),
        label: 'start 失敗', detail: String(err), tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  const answer = (allow: boolean): void => {
    if (!pending || !id) return
    void window.izuna.respondPermission({ id, requestId: pending.id,
      result: allow ? { behavior: 'allow' } : { behavior: 'deny', message: '人間が拒否しました' } })
    setPending(null)
  }

  return (
    <div style={S.app}>
      <div style={S.bar}>
        <span style={S.brand}>Izuna</span>
        <span style={S.note}>段1-a 動作確認</span>
        <div style={{ flexGrow: 1 }} />
        <span style={{ ...S.note, color: id ? TONE.good : '#4a5164' }}>
          {id ? `session ${id.slice(0, 8)}` : '未起動'}
        </span>
      </div>

      <div style={S.row}>
        <input style={S.input} value={cwd} placeholder="作業ディレクトリの絶対パス"
          onChange={(e) => setCwd(e.target.value)} spellCheck={false} />
        <button style={S.btn} disabled={busy || !!id} onClick={() => void start()}>
          {busy ? '起動中…' : '起動'}
        </button>
        <button style={S.btnGhost} disabled={!id} onClick={() => { if (id) void window.izuna.stop(id).then(() => setId(null)) }}>
          停止
        </button>
      </div>

      <div style={S.row}>
        <input style={S.input} value={prompt} onChange={(e) => setPrompt(e.target.value)} spellCheck={false} />
        <button style={S.btn} disabled={!id} onClick={() => { if (id) void window.izuna.send(id, prompt) }}>送信</button>
      </div>

      {pending && (
        <div style={S.perm}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <b>{pending.toolName}</b>
            <span style={S.note}>{JSON.stringify(pending.input).slice(0, 140)}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.btn} onClick={() => answer(true)}>許可</button>
            <button style={S.btnGhost} onClick={() => answer(false)}>拒否</button>
          </div>
        </div>
      )}

      <div style={S.log} ref={logRef}>
        {rows.length === 0 && <div style={S.note}>作業ディレクトリを入れて「起動」を押してください</div>}
        {rows.map((r, i) => (
          <div key={i} style={S.line}>
            <span style={S.time}>{r.at}</span>
            <span style={{ ...S.label, color: TONE[r.tone] }}>{r.label}</span>
            <span style={S.detail}>{r.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const mono = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
const S: Record<string, React.CSSProperties> = {
  app: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 10,
    padding: 14, background: '#14161b', color: '#e6e8ee',
    font: "13px/1.6 'IBM Plex Sans', system-ui, sans-serif" },
  bar: { display: 'flex', alignItems: 'center', gap: 12 },
  brand: { fontWeight: 600, letterSpacing: '0.02em' },
  note: { fontSize: 11.5, color: '#7d8598' },
  row: { display: 'flex', gap: 8 },
  input: { flexGrow: 1, minWidth: 0, padding: '9px 12px', borderRadius: 7, border: '1px solid #2c3140',
    background: '#171a21', color: '#e6e8ee', font: `12px ${mono}`, outline: 'none' },
  btn: { padding: '9px 18px', borderRadius: 7, border: 'none', background: '#e8a33d',
    color: '#16130c', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' },
  btnGhost: { padding: '9px 18px', borderRadius: 7, border: '1px solid #2c3140',
    background: 'transparent', color: '#c8cddb', fontSize: 12.5, cursor: 'pointer' },
  perm: { border: '1px solid #3d3527', background: '#1a1710', borderRadius: 9,
    padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'space-between' },
  log: { flexGrow: 1, minHeight: 0, overflowY: 'auto', border: '1px solid #242832',
    borderRadius: 9, background: '#0d0f13', padding: '10px 12px' },
  line: { display: 'flex', gap: 12, padding: '3px 0', alignItems: 'baseline' },
  time: { font: `11px ${mono}`, color: '#4a5164', flexShrink: 0 },
  label: { font: `11px ${mono}`, width: 92, flexShrink: 0 },
  detail: { fontSize: 12, color: '#c8cddb', wordBreak: 'break-word' }
}

export default App
