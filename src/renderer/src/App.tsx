import { useEffect, useRef, useState } from 'react'
import type { PermissionMode, PermissionResult, SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import { applyCompletion, filterCommands, parseSlashInput } from '../../shared/palette'
import { appendUserText, markDenied, setPermissionMode } from '../../shared/transcript'
import { C, MONO, SANS } from './theme'
import { Conversation } from './components/Conversation'
import { ModeSwitch } from './components/ModeSwitch'
import { NewSession } from './components/NewSession'
import { Palette } from './components/Palette'
import { PermissionBar } from './components/PermissionBar'
import { Sidebar } from './components/Sidebar'
import { TaskPanel } from './components/TaskPanel'
import { ForgeSetup } from './components/ForgeSetup'
import { Forge } from './components/Forge'
import { TextArea } from './components/ui'
import { TerminalPane } from './components/TerminalPane'
import { Inspector } from './components/Inspector'
import { Worktrees } from './components/Worktrees'
import { useSessions } from './useSessions'
import { IPC_VERSION } from '../../shared/ipc'

/**
 * Izuna の画面（段3 まで）。
 *
 * 状態の組み立ては `shared/`（純粋関数・録画で検査済み）が持ち、
 * ここは描画と入出力だけ。疑わしいときは先に `pnpm verify` を見ること。
 */
function App(): React.JSX.Element {
  const sessions = useSessions()
  const { active } = sessions
  const [showNew, setShowNew] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [showTerm, setShowTerm] = useState(false)
  const [tab, setTab] = useState<'info' | 'pr' | 'branch'>('info')
  const [stale, setStale] = useState(false)

  // main は HMR で入れ替わらない。食い違ったまま動くと、原因を指さない
  // 「No handler registered」に化ける（実際に 5 時間古い main で踏んだ）
  useEffect(() => {
    window.izuna.ipcVersion()
      .then((v) => setStale(v !== IPC_VERSION))
      .catch(() => setStale(true))
  }, [])
  const [picked, setPicked] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  const slash = active ? parseSlashInput(active.prompt) : null
  const results = active && slash && !dismissed ? filterCommands(slash.name, active.commands) : []
  const paletteOpen = !!active && slash !== null && !dismissed && active.commands.length > 0

  // 下に貼りつく。人が上を読んでいる最中は邪魔しない
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTo({ top: el.scrollHeight })
  }, [active?.transcript, active?.pending])

  // セッションを切り替えたらパレットは畳む
  useEffect(() => { setDismissed(false); setPicked(0) }, [sessions.activeId])

  const setPrompt = (value: string): void => {
    if (active) sessions.update(active.id, (p) => ({ ...p, prompt: value }))
  }

  const complete = (command: SlashCommand): void => {
    setPrompt(applyCompletion(command, slash?.args ?? ''))
    setDismissed(true)
    box.current?.focus()
  }

  const send = (): void => {
    if (!active) return
    const text = active.prompt.trim()
    if (!text) return
    sessions.update(active.id, (p) => ({
      ...p, prompt: '', transcript: appendUserText(p.transcript, text, `u${p.transcript.items.length}`)
    }))
    setDismissed(false)
    void window.izuna.send(active.id, text)
  }

  const respond = (result: PermissionResult): void => {
    if (!active?.pending) return
    const { id, pending } = { id: active.id, pending: active.pending }
    // 拒否は自分で覚える。結果の文面から当てない（transcript.ts の註）
    sessions.update(id, (p) => ({
      ...p,
      pending: null,
      transcript: result.behavior === 'deny' ? markDenied(p.transcript, pending.toolUseId) : p.transcript
    }))
    void window.izuna.respondPermission({ id, requestId: pending.id, result })
  }

  const changeMode = (mode: PermissionMode): void => {
    if (!active) return
    const id = active.id
    const previous = active.transcript.permissionMode
    sessions.update(id, (p) => ({ ...p, transcript: setPermissionMode(p.transcript, mode) }))
    // 通知イベントが無いので楽観的に進め、失敗したら戻す
    void window.izuna.setPermissionMode(id, mode).catch(() => {
      sessions.update(id, (p) => ({ ...p, transcript: setPermissionMode(p.transcript, previous) }))
    })
  }

  return (
    <div style={S.app}>
      {stale && (
        <div style={S.stale}>
          <b>main プロセスが古いままです。</b>
          <span style={{ opacity: 0.85 }}>
            renderer は更新されましたが main は入れ替わっていません。
            <code style={{ font: `11px ${MONO}`, padding: '2px 6px', background: 'rgba(0,0,0,0.25)', borderRadius: 4, margin: '0 4px' }}>
              pnpm dev
            </code>
            を起動し直してください。
          </span>
        </div>
      )}
      <Sidebar
        panels={sessions.panels}
        activeId={sessions.activeId}
        onSelect={sessions.setActive}
        onClose={(id) => void sessions.close(id)}
        onNew={() => setShowNew(true)}
      />

      <div style={S.main}>
        <div style={S.bar}>
          <span style={S.brand}>Izuna</span>
          {active && (
            <>
              <span style={S.tag}>{active.label}</span>
              {active.transcript.model && (
                <span style={S.tag}>{active.transcript.model.replace(/-\d{8}$/, '')}</span>
              )}
              <ModeSwitch mode={active.transcript.permissionMode} disabled={active.ended} onChange={changeMode} />
            </>
          )}
          <div style={{ flexGrow: 1 }} />
          {sessions.panels.filter((p) => p.transcript.state === 'running').length > 0 && (
            <span style={{ ...S.note, color: C.teal }}>
              {sessions.panels.filter((p) => p.transcript.state === 'running').length} 実行中
            </span>
          )}
          {sessions.waiting.length > 0 && (
            <span style={{ ...S.note, color: C.amber }}>承認待ち {sessions.waiting.length}</span>
          )}
          {active?.transcript.limits && (
            // 金額は出さない。課金されない額を出すと誤解される（CLAUDE.md §14）。
            // 実際の制約はサブスクリプションの枠のほう
            <span style={S.note} title="Pro プランの枠の使用率。ターミナルの Claude Code と同じ窓を共有します">
              枠 {Math.round(active.transcript.limits.fiveHour * 100)}%
              <span style={{ color: C.faint }}> / 5時間</span>
            </span>
          )}
          {active && (
            <button style={S.ghostSmall} onClick={() => void window.izuna.interrupt(active.id)}>中断</button>
          )}
          {/* 破壊的な操作。ほかと同じ形にしない。実行中だけ出す */}
          {active?.transcript.state === 'running' && (
            <button style={S.danger} onClick={() => void window.izuna.interrupt(active.id)}>中断</button>
          )}
          {active && (
            <button
              style={{ ...S.ghostSmall, borderColor: showTerm ? C.line2 : 'transparent',
                color: showTerm ? C.ink2 : C.dim2 }}
              onClick={() => setShowTerm((v) => !v)}
              title="worktree のシェルを開く"
            >
              ターミナル
            </button>
          )}
          <button
            style={{ ...S.ghostSmall, borderColor: 'transparent', color: C.dim2 }}
            onClick={() => setShowSetup(true)}
            title="Forgejo と設定の準備"
          >
            準備
          </button>
        </div>

        {!active ? (
          <div style={S.empty}>
            <span style={{ color: C.dim, fontSize: 13 }}>セッションがありません</span>
            <button style={S.btn} onClick={() => setShowNew(true)}>新しいセッションを起こす</button>
          </div>
        ) : (
          <div style={{ flexGrow: 1, minHeight: 0, display: 'flex' }}>
            <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={S.body} ref={scroller}>
              <Conversation items={active.transcript.items} draft={active.transcript.draft} />
              <TaskPanel tasks={active.transcript.tasks} />
              {active.pending && (
                <div style={{ padding: '0 24px 24px' }}>
                  <PermissionBar
                    request={active.pending}
                    onAllow={(always) => respond(
                      always && active.pending?.suggestions?.length
                        ? { behavior: 'allow', updatedPermissions: active.pending.suggestions }
                        : { behavior: 'allow' }
                    )}
                    onDeny={() => respond({ behavior: 'deny', message: '人間が拒否しました' })}
                  />
                </div>
              )}
            </div>

            {showTerm && (
              <div style={{ height: 300, flexShrink: 0, borderTop: `1px solid ${C.line}` }}>
                <TerminalPane cwd={active.cwd} onClose={() => setShowTerm(false)} />
              </div>
            )}

            <div style={{ position: 'relative', flexShrink: 0 }}>
              {paletteOpen && (
                <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 16, right: 16, zIndex: 20 }}>
                  <Palette
                    results={results}
                    total={active.commands.length}
                    selected={Math.min(picked, Math.max(results.length - 1, 0))}
                    onSelect={setPicked}
                    onChoose={(hit) => complete(hit.command)}
                  />
                </div>
              )}
              {/* 入力欄と送信を 1 つの枠に入れる。別々に置くと箱の高さが違って揃わない */}
              <div style={S.footer}>
                <div style={S.inputBox}>
                  <TextArea
                    bare
                    ref={box}
                    value={active.prompt}
                    rows={2}
                    placeholder={active.ended ? 'このセッションは終了しています' : '依頼を書く'}
                    disabled={active.ended}
                    onChange={(e) => {
                      setPrompt(e.target.value)
                      setPicked(0)
                      if (e.target.value.startsWith('/')) setDismissed(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); return }
                      if (!paletteOpen || results.length === 0) return
                      const at = Math.min(picked, results.length - 1)
                      if (e.key === 'ArrowDown') { e.preventDefault(); setPicked((at + 1) % results.length) }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setPicked((at - 1 + results.length) % results.length) }
                      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); complete(results[at].command) }
                      else if (e.key === 'Escape') { e.preventDefault(); setDismissed(true) }
                    }}
                  />
                  <div style={S.inputFoot}>
                    <span style={{ font: `10px ${MONO}`, color: C.faint }}>/ コマンド</span>
                    <div style={{ flexGrow: 1 }} />
                    <span style={{ font: `10px ${MONO}`, color: C.faint }}>⌘↵</span>
                    <button style={S.send} disabled={active.ended || !active.prompt.trim()} onClick={send}>
                      送信
                    </button>
                  </div>
                </div>
              </div>
            </div>
            </div>
            <div style={{ width: tab === 'info' ? 288 : 360, flexShrink: 0, background: C.panel,
              borderLeft: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', flexShrink: 0, borderBottom: `1px solid ${C.line}` }}>
                {(['info', 'pr', 'branch'] as const).map((t) => (
                  <div key={t} onClick={() => setTab(t)} style={{
                    flexGrow: 1, textAlign: 'center', padding: '8px 0', cursor: 'pointer',
                    fontSize: 11, color: tab === t ? C.ink : C.dim2,
                    borderBottom: `2px solid ${tab === t ? C.amber : 'transparent'}`
                  }}>
                    {t === 'info' ? '情報' : t === 'pr' ? 'PR' : 'ブランチ'}
                  </div>
                ))}
              </div>
              <div style={{ flexGrow: 1, minHeight: 0 }}>
                {tab === 'info' && <Inspector panel={active} onOpenForge={() => setTab('pr')} />}
                {tab === 'pr' && <Forge cwd={active.cwd} onDone={() => setTab('info')} />}
                {tab === 'branch' && (
                  <Worktrees cwd={active.cwd} panels={sessions.panels}
                    onOpen={(w) => void sessions.open({
                      cwd: w.path, label: w.branch ?? w.path, branch: w.branch, team: w.branch ?? 'default'
                    })} />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showSetup && <ForgeSetup onClose={() => setShowSetup(false)} />}

      {showNew && (
        <NewSession
          initialCwd={localStorage.getItem('izuna.cwd') ?? ''}
          onCancel={() => setShowNew(false)}
          onStart={async (input) => {
            localStorage.setItem('izuna.cwd', input.cwd)
            await sessions.open(input)
            setShowNew(false)
          }}
        />
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  app: { position: 'absolute', inset: 0, display: 'flex', background: C.bg, color: C.ink,
    font: `13px/1.6 ${SANS}` },
  stale: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 60,
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
    background: C.red, color: '#fff', fontSize: 12 },
  main: { flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  bar: { display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 44,
    background: C.panel, borderBottom: `1px solid ${C.line}`, flexShrink: 0 },
  brand: { fontWeight: 600, letterSpacing: '0.02em' },
  tag: { font: `11px ${MONO}`, color: C.dim2, padding: '2px 8px',
    border: `1px solid ${C.line2}`, borderRadius: 4 },
  note: { fontSize: 11, color: C.dim2 },
  btn: { padding: '8px 24px', borderRadius: 7, border: 'none', background: C.amber,
    color: C.amberInk, fontWeight: 600, fontSize: 12, cursor: 'pointer' },
  ghostSmall: { padding: '6px 12px', borderRadius: 7, border: `1px solid ${C.line2}`,
    background: 'transparent', color: C.ink2, fontSize: 11, cursor: 'pointer' },
  /** 破壊的な操作。ほかのボタンと同じ形にしない */
  danger: { padding: '6px 12px', borderRadius: 7, border: `1px solid ${C.red}`,
    background: 'transparent', color: C.red, fontSize: 11, cursor: 'pointer' },
  empty: { flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 16 },
  body: { flexGrow: 1, minHeight: 0, overflowY: 'auto' },
  footer: { padding: '12px 16px 16px', borderTop: `1px solid ${C.line}`, flexShrink: 0 },
  inputBox: { border: `1px solid ${C.line2}`, borderRadius: 7, background: C.surface,
    display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  inputFoot: { display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px 8px 12px' },
  send: { padding: '6px 16px', borderRadius: 7, border: 'none', background: C.amber,
    color: C.amberInk, fontWeight: 600, fontSize: 12, cursor: 'pointer' }
}

export default App
