import { useEffect, useRef, useState } from 'react'
import type { PermissionMode, PermissionResult, SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import { applyCompletion, filterCommands, parseSlashInput } from '../../shared/palette'
import { appendUserText, markDenied, setPermissionMode } from '../../shared/transcript'
import { F, applySkin, C, MONO, READ, SANS } from './theme'
import { Conversation } from './components/Conversation'
import { ModeSwitch } from './components/ModeSwitch'
import { NewSession } from './components/NewSession'
import { Palette } from './components/Palette'
import { PermissionBar } from './components/PermissionBar'
import { Sidebar } from './components/Sidebar'
import { TaskPanel } from './components/TaskPanel'
import { ForgeSetup } from './components/ForgeSetup'
import { Forge } from './components/Forge'
import { Board } from './components/Board'
import { Files } from './components/Files'
import { Attachments } from './components/Attachments'
import { collectImages } from './images'
import type { Attachment } from '../../shared/image'
import { answerInput } from '../../shared/question'
import { Loop } from './components/Loop'
import { Button, TextArea } from './components/ui'
import { TerminalPane } from './components/TerminalPane'
import { Preview } from './components/Preview'
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
  // 中で見ている頁（§32）。無ければ null
  const [preview, setPreview] = useState<string | null>(null)
  const [tab, setTab] = useState<'info' | 'files' | 'board' | 'loop' | 'pr' | 'branch'>('info')
  const [stale, setStale] = useState(false)

  // 利用者の Ghostty のテーマを借りる。無ければ既定のまま（§21）
  useEffect(() => {
    void window.izuna
      .ghosttySkin()
      .then(applySkin)
      .catch(() => applySkin(null))
  }, [])

  // main は HMR で入れ替わらない。食い違ったまま動くと、原因を指さない
  // 「No handler registered」に化ける（実際に 5 時間古い main で踏んだ）
  useEffect(() => {
    window.izuna
      .ipcVersion()
      .then((v) => setStale(v !== IPC_VERSION))
      .catch(() => setStale(true))
  }, [])
  /**
   * パレットの状態は**どのセッションのものか**と一緒に持つ。セッションを切り替えたら
   * 自然に初期値に戻る。以前は effect で戻していたが、描画のあとに setState する形は
   * 再描画を重ねる（react-hooks/set-state-in-effect）。
   */
  const [pickedFor, setPickedFor] = useState<{ id: string | null; at: number }>({ id: null, at: 0 })
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const picked = pickedFor.id === sessions.activeId ? pickedFor.at : 0
  const dismissed = dismissedFor !== null && dismissedFor === sessions.activeId
  const setPicked = (at: number): void => setPickedFor({ id: sessions.activeId, at })
  const setDismissed = (v: boolean): void => setDismissedFor(v ? sessions.activeId : null)
  const scroller = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  // 貼った画像。**送るまでの控えで、どこにも保存しない**（送れば会話に残る）
  const [images, setImages] = useState<Attachment[]>([])
  const [rejected, setRejected] = useState<string[]>([])

  const take = (files: readonly File[]): void => {
    const pics = files.filter((f) => f.type.startsWith('image/'))
    if (pics.length === 0) return
    void collectImages(pics).then(({ ok, bad }) => {
      setImages((prev) => [...prev, ...ok])
      setRejected(bad)
    })
  }

  const slash = active ? parseSlashInput(active.prompt) : null
  const results = active && slash && !dismissed ? filterCommands(slash.name, active.commands) : []
  const paletteOpen = !!active && slash !== null && !dismissed && active.commands.length > 0

  // 下に貼りつく。人が上を読んでいる最中は邪魔しない
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120)
      el.scrollTo({ top: el.scrollHeight })
  }, [active?.transcript, active?.pending])

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
    // 画像だけ貼って送ろうとしたときは、何を見てほしいのかが無い。
    // **こちらで文面を作らない**（§17.5）ので、本文が空なら送らない
    if (!text) return
    const pics = images
    sessions.update(active.id, (p) => ({
      ...p,
      prompt: '',
      transcript: appendUserText(p.transcript, text, `u${p.transcript.items.length}`, pics)
    }))
    setDismissed(false)
    setImages([])
    setRejected([])
    void window.izuna.send(active.id, text, pics)
  }

  const respond = (result: PermissionResult): void => {
    if (!active?.pending) return
    const { id, pending } = { id: active.id, pending: active.pending }
    // 拒否は自分で覚える。結果の文面から当てない（transcript.ts の註）
    sessions.update(id, (p) => ({
      ...p,
      pending: null,
      transcript:
        result.behavior === 'deny' ? markDenied(p.transcript, pending.toolUseId) : p.transcript
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
            <code
              style={{
                font: `${F.small}px ${MONO}`,
                padding: '2px 6px',
                background: 'rgba(0,0,0,0.25)',
                borderRadius: 4,
                margin: '0 4px'
              }}
            >
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
        {/*
          上の帯は**セッションの状態を出す場所**で、名札ではない。「Izuna」の字は
          macOS の題名欄に既に出ているので、ここには書かない。セッションが無いときは
          出すものが無いので帯ごと出さない（準備の釦は空の画面に置く）。
        */}
        {active && (
          <div style={S.bar}>
            <span style={S.tag}>{active.label}</span>
            {active.transcript.model && (
              <span style={S.tag}>{active.transcript.model.replace(/-\d{8}$/, '')}</span>
            )}
            <ModeSwitch
              mode={active.transcript.permissionMode}
              disabled={active.ended}
              onChange={changeMode}
            />
            <div style={{ flexGrow: 1 }} />
            {sessions.panels.filter((p) => p.transcript.state === 'running').length > 0 && (
              <span style={{ ...S.note, color: C.teal }}>
                {sessions.panels.filter((p) => p.transcript.state === 'running').length} 実行中
              </span>
            )}
            {sessions.waiting.length > 0 && (
              <span style={{ ...S.note, color: C.amber }}>承認待ち {sessions.waiting.length}</span>
            )}
            {active.transcript.limits && (
              // 金額は出さない。課金されない額を出すと誤解される（CLAUDE.md §14）。
              // 実際の制約はサブスクリプションの上限のほう。
              //
              // **「使用量」とも書かない。** 「使用料」と一字しか違わず、金額を
              // 出していると読める。金額は §14 で消したのに、言葉のほうで
              // 戻してしまっていた。
              <span
                style={S.note}
                title="5 時間ごとの上限に対する割合。ターミナルの Claude Code と同じ上限を共有します"
              >
                5時間{' '}
                <span style={{ color: C.ink2 }}>
                  {Math.round(active.transcript.limits.fiveHour * 100)}%
                </span>
              </span>
            )}
            {/*
            **実行中だけ出す。** 止めるものが無いときに出ていると、
            何をする釦なのか分からない（実際 2 つ並べていて、片方は
            実行中かどうかに関係なく出ていた）。
          */}
            {active.transcript.state === 'running' && (
              <Button
                kind="danger"
                size="sm"
                onClick={() => void window.izuna.interrupt(active.id)}
              >
                止める
              </Button>
            )}
            <button
              style={{
                ...S.ghostSmall,
                borderColor: showTerm ? C.line2 : 'transparent',
                color: showTerm ? C.ink2 : C.dim2
              }}
              onClick={() => setShowTerm((v) => !v)}
              title="worktree のシェルを開く"
            >
              ターミナル
            </button>
            <button
              style={{ ...S.ghostSmall, borderColor: 'transparent', color: C.dim2 }}
              onClick={() => setShowSetup(true)}
              title="Forgejo と設定の準備"
            >
              準備
            </button>
          </div>
        )}

        {!active ? (
          <div style={S.empty}>
            <span style={{ color: C.dim, fontSize: F.base }}>セッションがありません</span>
            <button style={S.btn} onClick={() => setShowNew(true)}>
              新しいセッションを開く
            </button>
            <button
              style={{ ...S.ghostSmall, borderColor: 'transparent', color: C.dim2 }}
              onClick={() => setShowSetup(true)}
              title="Forgejo と設定の準備"
            >
              準備
            </button>
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
                      onAllow={(always) =>
                        respond(
                          always && active.pending?.suggestions?.length
                            ? { behavior: 'allow', updatedPermissions: active.pending.suggestions }
                            : { behavior: 'allow' }
                        )
                      }
                      // 問いへの答えは allow に updatedInput で載せる（shared/question.ts）
                      onAnswer={(answers) =>
                        respond({
                          behavior: 'allow',
                          updatedInput: answerInput(active.pending?.input, answers)
                        })
                      }
                      onDeny={() => respond({ behavior: 'deny', message: '拒否しました' })}
                    />
                  </div>
                )}
              </div>

              {preview && (
                <div
                  style={{
                    flexBasis: '58%',
                    flexShrink: 0,
                    minHeight: 240,
                    borderTop: `1px solid ${C.line}`
                  }}
                >
                  <Preview url={preview} onClose={() => setPreview(null)} />
                </div>
              )}

              {showTerm && (
                <div style={{ height: 300, flexShrink: 0, borderTop: `1px solid ${C.line}` }}>
                  <TerminalPane cwd={active.cwd} onClose={() => setShowTerm(false)} />
                </div>
              )}

              <div style={{ position: 'relative', flexShrink: 0 }}>
                {paletteOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 'calc(100% + 8px)',
                      left: 16,
                      right: 16,
                      zIndex: 20
                    }}
                  >
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
                  <div
                    style={S.inputBox}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      take([...e.dataTransfer.files])
                    }}
                  >
                    <Attachments
                      items={images}
                      rejected={rejected}
                      onRemove={(at) => setImages((prev) => prev.filter((_, i) => i !== at))}
                    />
                    <TextArea
                      bare
                      // 打つ字と読む字が違うのは落ち着かない。同じ組みにする
                      style={{ font: READ }}
                      ref={box}
                      value={active.prompt}
                      rows={2}
                      placeholder={
                        active.ended
                          ? 'このセッションは終了しています'
                          : '依頼を書く（画像は貼るか落とす）'
                      }
                      onPaste={(e) => take([...e.clipboardData.files])}
                      disabled={active.ended}
                      onChange={(e) => {
                        setPrompt(e.target.value)
                        setPicked(0)
                        if (e.target.value.startsWith('/')) setDismissed(false)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          send()
                          return
                        }
                        if (!paletteOpen || results.length === 0) return
                        const at = Math.min(picked, results.length - 1)
                        if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          setPicked((at + 1) % results.length)
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault()
                          setPicked((at - 1 + results.length) % results.length)
                        } else if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault()
                          complete(results[at].command)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          setDismissed(true)
                        }
                      }}
                    />
                    <div style={S.inputFoot}>
                      <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint }}>
                        / コマンド
                      </span>
                      <div style={{ flexGrow: 1 }} />
                      <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint }}>⌘↵</span>
                      <button
                        style={S.send}
                        disabled={active.ended || !active.prompt.trim()}
                        onClick={send}
                      >
                        送信
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div
              style={{
                width: tab === 'info' ? 288 : 360,
                flexShrink: 0,
                background: C.panel,
                borderLeft: `1px solid ${C.line}`,
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <div style={{ display: 'flex', flexShrink: 0, borderBottom: `1px solid ${C.line}` }}>
                {(['info', 'files', 'board', 'loop', 'pr', 'branch'] as const).map((t) => (
                  <div
                    key={t}
                    data-tab={t}
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    style={{
                      flexGrow: 1,
                      textAlign: 'center',
                      padding: '8px 0',
                      cursor: 'pointer',
                      fontSize: F.small,
                      color: tab === t ? C.ink : C.dim2,
                      borderBottom: `2px solid ${tab === t ? C.amber : 'transparent'}`
                    }}
                  >
                    {t === 'info'
                      ? '情報'
                      : t === 'files'
                        ? 'ファイル'
                        : t === 'board'
                          ? '盤面'
                          : t === 'loop'
                            ? 'ループ'
                            : t === 'pr'
                              ? 'PR'
                              : 'ブランチ'}
                  </div>
                ))}
              </div>
              <div style={{ flexGrow: 1, minHeight: 0 }}>
                {tab === 'info' && <Inspector panel={active} onOpenForge={() => setTab('pr')} />}
                {tab === 'files' && <Files panel={active} />}
                {tab === 'board' && <Board panel={active} />}
                {tab === 'loop' && <Loop panel={active} />}
                {tab === 'pr' && (
                  <Forge
                    cwd={active.cwd}
                    sessionId={active.id}
                    onDone={() => setTab('info')}
                    onPreview={setPreview}
                  />
                )}
                {tab === 'branch' && (
                  <Worktrees
                    cwd={active.cwd}
                    panels={sessions.panels}
                    onOpen={(w) =>
                      void sessions.open({
                        cwd: w.path,
                        label: w.branch ?? w.path,
                        branch: w.branch,
                        team: w.branch ?? 'default'
                      })
                    }
                  />
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
  app: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    background: C.bg,
    color: C.ink,
    font: `${F.base}px/1.6 ${SANS}`
  },
  stale: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 60,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    background: C.red,
    color: '#fff',
    fontSize: F.body
  },
  main: { flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 16px',
    height: 44,
    background: C.panel,
    borderBottom: `1px solid ${C.line}`,
    flexShrink: 0
  },
  tag: {
    font: `${F.small}px ${MONO}`,
    color: C.dim2,
    padding: '2px 8px',
    border: `1px solid ${C.line2}`,
    borderRadius: 4
  },
  note: { fontSize: F.small, color: C.dim2 },
  btn: {
    padding: '8px 24px',
    borderRadius: 7,
    border: 'none',
    background: C.amber,
    color: C.amberInk,
    fontWeight: 600,
    fontSize: F.body,
    cursor: 'pointer'
  },
  ghostSmall: {
    padding: '6px 12px',
    borderRadius: 7,
    border: `1px solid ${C.line2}`,
    background: 'transparent',
    color: C.ink2,
    fontSize: F.small,
    cursor: 'pointer'
  },
  /** 破壊的な操作。ほかのボタンと同じ形にしない */
  danger: {
    padding: '6px 12px',
    borderRadius: 7,
    border: `1px solid ${C.red}`,
    background: 'transparent',
    color: C.red,
    fontSize: F.small,
    cursor: 'pointer'
  },
  empty: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16
  },
  body: { flexGrow: 1, minHeight: 0, overflowY: 'auto' },
  footer: { padding: '12px 16px 16px', borderTop: `1px solid ${C.line}`, flexShrink: 0 },
  inputBox: {
    border: `1px solid ${C.line2}`,
    borderRadius: 7,
    background: C.surface,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  inputFoot: { display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px 8px 12px' },
  send: {
    padding: '6px 16px',
    borderRadius: 7,
    border: 'none',
    background: C.amber,
    color: C.amberInk,
    fontWeight: 600,
    fontSize: F.body,
    cursor: 'pointer'
  }
}

export default App
