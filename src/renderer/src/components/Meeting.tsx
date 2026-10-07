import { useCallback, useEffect, useRef, useState } from 'react'
import {
  speakerTitle,
  type Entry,
  type MeetingEvent,
  type MeetingSummary,
  type MeetingView,
  type Role
} from '../../../shared/meeting'
import { C, F, MONO, R, S, ellipsis } from '../theme'
import { Markdown } from './Markdown'
import { Button, Check, Faint, Loading, Section, Select, Tag, TextArea } from './ui'

/**
 * 会議（§39）。司会と参加者が話し、Izuna が発言録と議事録を書く。
 *
 * **この画面が答える問い**: 「あの件、誰が何と言って、何が決まったか」と
 * 「いま話しているのは誰で、どこまで進んだか」。
 *
 * 押した結果はその場に出す（§35）—— 送った一言は発言録の末尾にすぐ載る
 * （main が書いた分を `said` で返す）。止まっている会議に送れば、司会が続きを話す。
 */
export function Meeting({
  cwd,
  onClose
}: {
  /** いま開いているセッションの作業ディレクトリ。新しい会議の既定にする */
  cwd: string | null
  onClose: () => void
}): React.JSX.Element {
  const [list, setList] = useState<MeetingSummary[] | null>(null)
  // 読み終わるまで「役が無い」と言わない（design-system の門）
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback((): void => {
    void window.izuna
      .meetings()
      .then(setList)
      .catch((e: Error) => {
        setList([])
        setError(e.message)
      })
  }, [])

  useEffect(() => {
    reload()
    void window.izuna
      .meetingRoles()
      .then(setRoles)
      .catch((e: Error) => setError(`役を読めませんでした: ${e.message}`))
  }, [reload])

  // 始まった・止まった・閉じたで一覧の状態が変わる
  useEffect(
    () =>
      window.izuna.onEvent((e) => {
        if (e.kind === 'meeting' && (e.event.kind === 'running' || e.event.kind === 'closed'))
          reload()
      }),
    [reload]
  )

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8,9,12,0.62)',
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1080px, 94vw)',
          height: '88vh',
          display: 'flex',
          background: C.surface,
          border: `1px solid ${C.line2}`,
          borderRadius: 11,
          boxShadow: '0 28px 80px rgba(0,0,0,0.62)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            width: 260,
            flexShrink: 0,
            borderRight: `1px solid ${C.line}`,
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md, padding: S.xl }}>
            <span style={{ fontSize: F.title, color: C.ink }}>会議</span>
            <span style={{ flexGrow: 1 }} />
            <Button size="sm" kind="primary" onClick={() => setSelected(null)}>
              新しい会議
            </Button>
          </div>
          <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: `0 ${S.md}px` }}>
            {list === null ? (
              <Loading />
            ) : list.length === 0 ? (
              <Faint style={{ padding: S.md }}>まだありません</Faint>
            ) : (
              list.map((m) => (
                <div
                  key={m.id}
                  onClick={() => setSelected(m.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: S.hair,
                    padding: `${S.md}px ${S.lg}px`,
                    borderRadius: R.md,
                    cursor: 'pointer',
                    background: m.id === selected ? C.raised : 'transparent'
                  }}
                >
                  <span style={{ fontSize: F.body, color: C.ink2, ...ellipsis }}>{m.agenda}</span>
                  <span style={{ font: `${F.micro}px ${MONO}`, color: C.dim2, ...ellipsis }}>
                    <span style={{ color: m.running ? C.teal : C.dim2 }}>{stateOf(m)}</span>
                    {/* 状態を先に置く。狭いと右から切れるので、切れてよいのはリポジトリ名 */}
                    {` · ${dateOf(m.created)} · ${repoOf(m.cwd)}`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              padding: `${S.lg}px ${S.xl}px 0`
            }}
          >
            <Button size="sm" onClick={onClose}>
              閉じる
            </Button>
          </div>
          {error && (
            <div style={{ padding: `0 ${S.xl}px`, fontSize: F.small, color: C.red }}>{error}</div>
          )}
          {selected === null ? (
            <NewMeeting
              cwd={cwd}
              roles={roles}
              onStarted={(id) => {
                setSelected(id)
                reload()
              }}
            />
          ) : (
            <Opened key={selected} id={selected} roles={roles ?? []} />
          )}
        </div>
      </div>
    </div>
  )
}

const repoOf = (cwd: string): string => cwd.split('/').filter(Boolean).at(-1) ?? cwd

const dateOf = (iso: string): string => {
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 議事録を読む形に。ファイルの題と注記は画面の見出しと重なるので落とし、回の見出し（ISO の時刻）は
 * 発言録と同じ形にする。**ファイルは ISO のまま** —— 機械が読む形を崩さない
 */
function minutesForReading(text: string): string {
  return text
    .replace(/^# .*\n+(Izuna が書く.*\n)?/, '')
    .replace(/^## (\d{4}-\d{2}-\d{2}T[\d:.]+Z)$/gm, (_, iso: string) => `## ${dateOf(iso)}`)
}

function stateOf(m: { running: boolean; state: 'open' | 'closed' }): string {
  if (m.running) return '話しています'
  return m.state === 'closed' ? '議事録あり' : '止まっています'
}

/** 新しい会議の既定の参加者。3 つの用途（設計相談・プロダクトの判断・壁打ち）のどれにも効く組 */
const DEFAULT_PICK = ['architect', 'pdm', 'critic']

function NewMeeting({
  cwd,
  roles,
  onStarted
}: {
  cwd: string | null
  roles: Role[] | null
  onStarted: (id: string) => void
}): React.JSX.Element {
  const [repos, setRepos] = useState<string[] | null>(null)
  const [repo, setRepo] = useState(cwd ?? '')
  const [agenda, setAgenda] = useState('')
  const [picked, setPicked] = useState<string[]>(DEFAULT_PICK)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    void window.izuna
      .findRepos()
      .then((found) => {
        const paths = found.map((f) => f.path)
        setRepos(cwd && !paths.includes(cwd) ? [cwd, ...paths] : paths)
      })
      .catch(() => setRepos(cwd ? [cwd] : []))
  }, [cwd])

  const chosen = picked.filter((n) => roles?.some((r) => r.name === n))
  const ready = !!repo && !!agenda.trim() && chosen.length > 0 && !busy

  const start = (): void => {
    setBusy(true)
    setFailed(null)
    void window.izuna
      .meetingStart({ cwd: repo, agenda, roles: chosen })
      .then(onStarted)
      .catch((e: Error) => setFailed(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl, padding: S.xl }}>
        <Section label="リポジトリ">
          <Select
            label="リポジトリ"
            value={repo}
            onChange={setRepo}
            options={repos ?? []}
            placeholder="選んでください"
          />
          <Faint>参加者はこのリポジトリのファイルを読みます。書きません。</Faint>
        </Section>
        <Section label="議題">
          <TextArea
            aria-label="議題"
            rows={4}
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            placeholder="例: 設定画面を作るか、設定ファイルのままにするか"
          />
        </Section>
        <Section label="参加者">
          {roles === null ? (
            <Loading />
          ) : (
            roles.map((r) => (
              <Check
                key={r.name}
                checked={picked.includes(r.name)}
                onChange={(on) =>
                  setPicked((prev) => (on ? [...prev, r.name] : prev.filter((n) => n !== r.name)))
                }
              >
                <span style={{ color: C.ink2, flexShrink: 0 }}>{r.title}</span>
                <span style={{ fontSize: F.small, color: C.faint, ...ellipsis }}>{r.brief}</span>
              </Check>
            ))
          )}
          <Faint>
            {
              '役は ~/.izuna/roles/ のファイルです。足すときは同じ形のファイルを置きます。同じリポジトリの同じ役は、前の会議の発言を覚えています。'
            }
          </Faint>
        </Section>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.md }}>
          <Button
            kind="primary"
            disabled={!ready}
            onClick={start}
            reserve={['始める', '始めています…']}
          >
            {busy ? '始めています…' : '始める'}
          </Button>
          {failed && <span style={{ fontSize: F.small, color: C.red }}>{failed}</span>}
        </div>
      </div>
    </div>
  )
}

function Opened({ id, roles }: { id: string; roles: Role[] }): React.JSX.Element {
  const [view, setView] = useState<MeetingView | null>(null)
  const [speaking, setSpeaking] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  /**
   * 読み込みの途中に届いた出来事を溜め、読み終わった中身に重ねる。捨てると、始めた直後の
   * 「話しています」や最初の発言が開き直すまで出ない。読み直すだけだと、読み直しの途中に来たものを
   * また落とす（2026-10-07 のレビューで 2 度指摘）。重ねるときは同じ発言を 2 度足さない
   */
  const pending = useRef<MeetingEvent[] | null>([])

  useEffect(() => {
    pending.current = []
    void window.izuna
      .meetingRead(id)
      .then((v) => {
        const queued = pending.current ?? []
        pending.current = null
        setView(queued.reduce(applyEvent, v))
      })
      .catch((e: Error) => setNotice(e.message))
  }, [id])

  useEffect(
    () =>
      window.izuna.onEvent((e) => {
        if (e.kind !== 'meeting' || e.id !== id) return
        const ev = e.event
        // 画面の外の印（誰が話しているか、壊れた理由）は、読み込みを待たずに出す
        if (ev.kind === 'speaking') setSpeaking(ev.who)
        else if (ev.kind === 'error') setNotice(ev.message)
        // 走り始めたら、前の失敗の文字は消す（直って続いているのに赤いまま残さない）
        else if (ev.kind === 'running' && ev.running) setNotice(null)
        else if (ev.kind === 'running' && !ev.running) {
          setSpeaking(null)
          setClosing(false)
        }
        if (pending.current) pending.current.push(ev)
        else setView((v) => (v ? applyEvent(v, ev) : v))
      }),
    [id]
  )

  /**
   * 話している最中に発言が来たら末尾を見せる。**開いた直後は送らない** —— 閉じた会議で
   * まず見たいのは上の議事録で、末尾へ送ると押し出される（`pnpm shots` で見つけた）。
   * jsdom には scrollIntoView が無い
   */
  const count = view?.entries.length ?? 0
  const live = view?.running ?? false
  useEffect(() => {
    if (live) end.current?.scrollIntoView?.({ block: 'end' })
  }, [count, live])

  if (!view) return notice ? <Faint style={{ padding: S.xl }}>{notice}</Faint> : <Loading />

  const send = (): void => {
    const body = text.trim()
    if (!body) return
    setText('')
    void window.izuna.meetingSay(id, body).catch((e: Error) => setNotice(e.message))
  }

  return (
    <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: S.sm,
          padding: `0 ${S.xl}px ${S.lg}px`
        }}
      >
        <span style={{ fontSize: F.title, color: C.ink }}>{view.meta.agenda}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
          <span style={{ font: `${F.micro}px ${MONO}`, color: C.dim2 }}>
            {repoOf(view.meta.cwd)}
          </span>
          {view.meta.roles.map((n) => (
            <Tag key={n}>{speakerTitle(n, roles)}</Tag>
          ))}
          <span style={{ flexGrow: 1 }} />
          {view.running && (
            <>
              <Button
                size="sm"
                disabled={closing}
                onClick={() => {
                  setClosing(true)
                  void window.izuna.meetingClose(id)
                }}
              >
                {closing ? '次の指名で締めます' : '締める'}
              </Button>
              <Button size="sm" kind="danger" onClick={() => void window.izuna.meetingStop(id)}>
                止める
              </Button>
            </>
          )}
        </div>
      </div>

      <div
        style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', borderTop: `1px solid ${C.line}` }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: S.xl, padding: S.xl }}>
          {view.minutes && (
            <Section label="議事録">
              <div
                style={{
                  border: `1px solid ${C.line2}`,
                  borderRadius: R.md,
                  padding: `${S.md}px ${S.lg}px`
                }}
              >
                <Markdown text={minutesForReading(view.minutes)} />
              </div>
            </Section>
          )}
          <Section label="発言録">
            {view.entries.map((e, i) => (
              <Said key={i} entry={e} roles={roles} />
            ))}
            {view.running && (
              <Faint>
                {speaking
                  ? `${speakerTitle(speaking, roles)}が話しています…`
                  : '司会が進めています…'}
              </Faint>
            )}
            <div ref={end} />
          </Section>
          {notice && <span style={{ fontSize: F.small, color: C.red }}>{notice}</span>}
        </div>
      </div>

      <div
        style={{
          borderTop: `1px solid ${C.line}`,
          padding: `${S.md}px ${S.xl}px`,
          display: 'flex',
          gap: S.md,
          alignItems: 'flex-end'
        }}
      >
        <TextArea
          aria-label="発言"
          rows={2}
          value={text}
          style={{ flexGrow: 1 }}
          placeholder={
            view.running
              ? '割り込んで話す。司会が次の指名のときに読みます'
              : '続きを話す。司会が会議を再開します'
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <Button kind="primary" disabled={!text.trim()} onClick={send}>
          送る
        </Button>
      </div>
    </div>
  )
}

/** 出来事を中身に重ねる。発言は時刻・話者・本文が同じものを 2 度足さない */
function applyEvent(v: MeetingView, ev: MeetingEvent): MeetingView {
  if (ev.kind === 'said') {
    const dup = v.entries.some(
      (e) => e.at === ev.entry.at && e.who === ev.entry.who && e.text === ev.entry.text
    )
    return dup ? v : { ...v, entries: [...v.entries, ev.entry] }
  }
  if (ev.kind === 'closed') return { ...v, minutes: ev.minutes }
  if (ev.kind === 'running') return { ...v, running: ev.running }
  return v
}

function Said({ entry, roles }: { entry: Entry; roles: Role[] }): React.JSX.Element {
  const moderator = entry.who === 'moderator'
  // アンバーは承認待ちだけに使う（Sidebar.tsx）。人の発言は地の字で立たせる
  const color = entry.who === 'human' ? C.ink : moderator ? C.dim2 : C.teal
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xs, padding: `${S.sm}px 0` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md }}>
        <span style={{ fontSize: F.small, fontWeight: 600, color }}>
          {speakerTitle(entry.who, roles)}
        </span>
        <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint }}>{dateOf(entry.at)}</span>
      </div>
      {moderator ? (
        <span style={{ fontSize: F.small, color: C.dim }}>{entry.text}</span>
      ) : (
        <Markdown text={entry.text} />
      )}
    </div>
  )
}
