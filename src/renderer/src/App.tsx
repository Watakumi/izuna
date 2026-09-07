import { useCallback, useEffect, useRef, useState } from 'react'
import type { PermissionMode, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionRequest } from '../../main/claude/session'
import type { SessionId } from '../../shared/ipc'
import {
  appendUserText,
  applyMessage,
  emptyTranscript,
  setPermissionMode,
  type Transcript
} from '../../shared/transcript'
import { C, MONO, SANS } from './theme'
import { Conversation } from './components/Conversation'
import { PermissionBar } from './components/PermissionBar'
import { ModeSwitch } from './components/ModeSwitch'

/**
 * 段1 の画面。1 セッションを動かし、承認と差分が見える。
 *
 * 状態の組み立ては `shared/transcript.ts`（純粋関数・録画で検査済み）に任せ、
 * ここは描画と入出力だけを持つ。ここが疑わしいときは、まず
 * `pnpm verify` が緑かを見ること —— 緑なら原因は必ずこちら側にある。
 */
function App(): React.JSX.Element {
  const [cwd, setCwd] = useState(() => localStorage.getItem('izuna.cwd') ?? '')
  const [id, setId] = useState<SessionId | null>(null)
  const [starting, setStarting] = useState(false)
  const [t, setT] = useState<Transcript>(emptyTranscript)
  const [pending, setPending] = useState<PermissionRequest | null>(null)
  const [prompt, setPrompt] = useState('')
  const scroller = useRef<HTMLDivElement>(null)

  const notice = useCallback((text: string, tone: 'warn' | 'bad') => {
    setT((prev) => ({
      ...prev,
      items: [...prev.items, { kind: 'notice', id: `n${prev.items.length}`, tone, text }],
      running: false
    }))
  }, [])

  useEffect(() => window.izuna.onEvent((event) => {
    if (event.kind === 'message') setT((prev) => applyMessage(prev, event.message))
    else if (event.kind === 'permission') setPending(event.request)
    else if (event.kind === 'error') notice(event.message, 'bad')
    else {
      notice('セッションが終了しました', 'warn')
      setId(null)
    }
  }), [notice])

  // 下に貼りつく。人が上にスクロールしている最中は邪魔しない
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (atBottom) el.scrollTo({ top: el.scrollHeight })
  }, [t, pending])

  const start = async (): Promise<void> => {
    if (!cwd.trim()) return
    setStarting(true)
    setT(emptyTranscript())
    try {
      localStorage.setItem('izuna.cwd', cwd)
      setId(await window.izuna.start({ cwd: cwd.trim() }))
    } catch (err) {
      notice(`起動に失敗しました: ${String(err)}`, 'bad')
    } finally {
      setStarting(false)
    }
  }

  const send = (): void => {
    const text = prompt.trim()
    if (!id || !text) return
    setT((prev) => appendUserText(prev, text, `u${prev.items.length}`))
    setPrompt('')
    void window.izuna.send(id, text)
  }

  const changeMode = (mode: PermissionMode): void => {
    if (!id) return
    const previous = t.permissionMode
    setT((prev) => setPermissionMode(prev, mode))
    // 通知イベントが無いので楽観的に進め、失敗したら戻す
    void window.izuna.setPermissionMode(id, mode).catch((err) => {
      setT((prev) => setPermissionMode(prev, previous))
      notice(`モードを変えられませんでした: ${String(err)}`, 'bad')
    })
  }

  const respond = (result: PermissionResult): void => {
    if (!id || !pending) return
    void window.izuna.respondPermission({ id, requestId: pending.id, result })
    setPending(null)
  }

  return (
    <div style={S.app}>
      <div style={S.bar}>
        <span style={S.brand}>Izuna</span>
        {t.model && <span style={S.tag}>{t.model.replace(/-\d{8}$/, '')}</span>}
        <ModeSwitch mode={t.permissionMode} disabled={!id} onChange={changeMode} />
        <div style={{ flexGrow: 1 }} />
        {t.state === 'running' && <span style={{ ...S.note, color: C.teal }}>実行中</span>}
        {pending && <span style={{ ...S.note, color: C.amber }}>承認待ち</span>}
        {t.costUsd !== null && <span style={S.note}>${t.costUsd.toFixed(4)}</span>}
        <span style={{ ...S.note, color: id ? C.teal : C.faint }}>
          {id ? `${t.slashCommands.length} コマンド` : '未起動'}
        </span>
      </div>

      <div style={S.row}>
        <input style={S.input} value={cwd} placeholder="作業ディレクトリの絶対パス"
          spellCheck={false} onChange={(e) => setCwd(e.target.value)} />
        {id ? (
          <>
            <button style={S.ghost} onClick={() => void window.izuna.interrupt(id)}>中断</button>
            <button style={S.ghost} onClick={() => void window.izuna.stop(id).then(() => setId(null))}>停止</button>
          </>
        ) : (
          <button style={S.btn} disabled={starting} onClick={() => void start()}>
            {starting ? '起動中…' : '起動'}
          </button>
        )}
      </div>

      <div style={S.body} ref={scroller}>
        <Conversation items={t.items} draft={t.draft} />
        {pending && (
          <div style={{ padding: '0 24px 22px' }}>
            <PermissionBar
              request={pending}
              onAllow={(always) => respond(
                always && pending.suggestions?.length
                  ? { behavior: 'allow', updatedPermissions: pending.suggestions }
                  : { behavior: 'allow' }
              )}
              onDeny={() => respond({ behavior: 'deny', message: '人間が拒否しました' })}
            />
          </div>
        )}
      </div>

      <div style={S.footer}>
        <textarea
          style={S.textarea}
          value={prompt}
          rows={2}
          placeholder={id ? '依頼を書く（⌘↵ で送信）' : '先に起動してください'}
          disabled={!id}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button style={S.btn} disabled={!id || !prompt.trim()} onClick={send}>送信</button>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  app: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
    background: C.bg, color: C.ink, font: `13px/1.6 ${SANS}` },
  bar: { display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', height: 42,
    background: C.panel, borderBottom: `1px solid ${C.line}`, flexShrink: 0 },
  brand: { fontWeight: 600, letterSpacing: '0.02em' },
  tag: { font: `11px ${MONO}`, color: C.dim2, padding: '2px 7px',
    border: `1px solid ${C.line2}`, borderRadius: 4 },
  note: { fontSize: 11.5, color: C.dim2 },
  row: { display: 'flex', gap: 8, padding: '12px 16px 0', flexShrink: 0 },
  input: { flexGrow: 1, minWidth: 0, padding: '9px 12px', borderRadius: 7,
    border: `1px solid ${C.line2}`, background: C.surface, color: C.ink,
    font: `12px ${MONO}`, outline: 'none' },
  btn: { padding: '9px 20px', borderRadius: 7, border: 'none', background: C.amber,
    color: C.amberInk, fontWeight: 600, fontSize: 12.5, cursor: 'pointer' },
  ghost: { padding: '9px 18px', borderRadius: 7, border: `1px solid ${C.line2}`,
    background: 'transparent', color: C.ink2, fontSize: 12.5, cursor: 'pointer' },
  body: { flexGrow: 1, minHeight: 0, overflowY: 'auto' },
  footer: { display: 'flex', gap: 8, alignItems: 'flex-end', padding: '12px 16px 16px',
    borderTop: `1px solid ${C.line}`, flexShrink: 0 },
  textarea: { flexGrow: 1, minWidth: 0, padding: '10px 13px', borderRadius: 9,
    border: `1px solid ${C.line2}`, background: C.surface, color: C.ink,
    font: `13px/1.6 ${SANS}`, outline: 'none', resize: 'none' }
}

export default App
