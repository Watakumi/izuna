import { useCallback, useEffect, useState } from 'react'
import { diagnose, readyForForge, type Check } from '../../../shared/forge'
import { diagnoseClaude, readyForClaude } from '../../../shared/prereq'
import type { FixId } from '../../../main/forge/setup'
import type { ForgejoRepo, ForgejoToken } from '../../../main/forge/client'
import { F, C, MONO, R, S, ellipsis } from '../theme'
import { Button, Input, Reload, Tag } from './ui'

/**
 * Forgejo のセットアップ（段5 の入口）。
 *
 * **検出は自動、変更は明示のクリック。** 利用者の Forgejo 設定を黙って
 * 書き換えない。押す前に何をするかを必ず見せる。
 */
const FIX_OF: Partial<Record<Check['id'], FixId>> = {
  installed: 'install',
  running: 'start',
  token: 'token',
  actions: 'actions',
  runner: 'runnerToken'
}

const MARK: Record<Check['level'], { icon: string; color: string }> = {
  ok: { icon: '✓', color: C.teal },
  warn: { icon: '!', color: C.amber },
  ng: { icon: '×', color: C.red },
  unknown: { icon: '?', color: C.faint }
}

export function ForgeSetup({
  onClose,
  onPreview
}: {
  onClose: () => void
  /** Forgejo の頁を窓の中で開く（§32）。省略なら外のブラウザに逃がす */
  onPreview?: (url: string) => void
}): React.JSX.Element {
  const [checks, setChecks] = useState<Check[] | null>(null)
  /** Claude Code の関所（docs/SETUP.md）。Forgejo より先に見る */
  const [claude, setClaude] = useState<Check[] | null>(null)
  /** 手元に forgejo が無い構成。トークンは人が作って貼る */
  const [remote, setRemote] = useState(false)
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState<Check['id'] | null>(null)
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)
  const [cfg, setCfg] = useState<{ path: string; ignored: string[]; exists: boolean } | null>(null)

  useEffect(() => {
    void window.izuna
      .configInfo()
      .then(setCfg)
      .catch(() => undefined)
  }, [])

  const refresh = useCallback(async () => {
    const [facts, cl] = await Promise.all([
      window.izuna.forgeFacts(),
      window.izuna.claudeStatus().catch(() => null)
    ])
    setChecks(diagnose(facts))
    setRemote(facts.remote)
    setClaude(cl ? diagnoseClaude(cl) : null)
  }, [])

  useEffect(() => {
    // 取ってきてから setState する（await の後）。同期の setState ではない
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const fix = async (check: Check): Promise<void> => {
    const id = FIX_OF[check.id]
    if (!id) return
    setBusy(check.id)
    setMessage(null)
    try {
      setMessage({ text: await window.izuna.forgeFix(id), bad: false })
      await refresh()
    } catch (e) {
      setMessage({ text: String(e).replace(/^Error:\s*/, ''), bad: true })
    } finally {
      setBusy(null)
    }
  }

  const ready =
    (checks ? readyForForge(checks) : false) && (claude ? readyForClaude(claude) : false)

  const paste = async (): Promise<void> => {
    setBusy('token')
    setMessage(null)
    try {
      setMessage({ text: await window.izuna.forgeSetToken(pasted), bad: false })
      setPasted('')
      await refresh()
    } catch (e) {
      setMessage({ text: String(e).replace(/^Error:\s*/, ''), bad: true })
    } finally {
      setBusy(null)
    }
  }

  // 部品ではなく関数。描画のたびに部品を作り直すと、行の状態が毎回消える
  const row = (c: Check): React.JSX.Element => {
    const m = MARK[c.level]
    return (
      <div
        key={c.id}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: '12px 12px',
          borderRadius: 7,
          border: `1px solid ${C.line}`
        }}
      >
        <span style={{ color: m.color, font: `${F.base}px ${MONO}`, width: 12, flexShrink: 0 }}>
          {m.icon}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
          <span style={{ fontSize: F.body }}>{c.label}</span>
          <span style={{ font: `${F.small}px ${MONO}`, color: C.dim2, wordBreak: 'break-all' }}>
            {c.detail}
          </span>
          {c.fix?.warning && (
            <span style={{ fontSize: F.small, color: C.faint }}>{c.fix.warning}</span>
          )}
        </div>
        {c.fix && (
          <Button kind="primary" size="sm" disabled={busy !== null} onClick={() => void fix(c)}>
            {busy === c.id ? '実行しています…' : c.fix.label}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8,9,12,0.62)',
        zIndex: 40,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 64
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 660,
          // 窓より縦に長くなると、下の項目（sandbox の一覧・トークン）が画面の外に出て押せない。
          // 覆いは fixed でスクロールしないので、中をスクロールさせる（NewSession と同じ）。
          // pnpm e2e が「sandbox 1 件」を押せずに見つけた（2026-09-10）
          maxHeight: '84vh',
          background: C.surface,
          border: `1px solid ${C.line2}`,
          borderRadius: 11,
          boxShadow: '0 28px 80px rgba(0,0,0,0.62)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div
          style={{
            padding: '16px 16px',
            borderBottom: `1px solid ${C.line}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}
        >
          <span style={{ fontWeight: 600 }}>準備</span>
          <span style={{ fontSize: F.small, color: C.dim2 }}>
            調べるだけ。変えるのは押したときだけ
          </span>
          <div style={{ flexGrow: 1 }} />
          <Reload onClick={() => void refresh()} />
        </div>

        <div
          style={{
            flexGrow: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          {!checks && (
            <div style={{ padding: 12, color: C.faint, fontSize: F.body }}>読んでいます…</div>
          )}
          {claude && (
            <>
              <span
                style={{
                  fontSize: F.small,
                  letterSpacing: '0.08em',
                  color: C.dim2,
                  fontWeight: 600
                }}
              >
                Claude Code
              </span>
              {claude.map(row)}
            </>
          )}
          {checks && (
            <span
              style={{ fontSize: F.small, letterSpacing: '0.08em', color: C.dim2, fontWeight: 600 }}
            >
              Forgejo
            </span>
          )}
          {checks?.map(row)}

          {/* 手元に forgejo が無ければ発行できない。人が Forgejo で作ったボットのトークンを貼る（docs/SETUP.md） */}
          {remote && checks?.some((c) => c.id === 'token' && c.level !== 'ok') && (
            <div style={{ display: 'flex', gap: S.md, alignItems: 'center' }}>
              <Input
                value={pasted}
                placeholder="izuna のトークンを貼る"
                type="password"
                onChange={(e) => setPasted(e.target.value)}
                style={{ flexGrow: 1 }}
              />
              <Button
                kind="primary"
                size="sm"
                disabled={busy !== null || !pasted.trim()}
                onClick={() => void paste()}
              >
                {busy === 'token' ? '確かめています…' : '保管する'}
              </Button>
            </div>
          )}

          <Repos onPreview={onPreview} />
          <Tokens onPreview={onPreview} />

          {message && (
            <div
              style={{
                border: `1px solid ${message.bad ? C.red : C.line2}`,
                borderRadius: 7,
                padding: '12px 12px',
                fontSize: F.body,
                color: message.bad ? C.red : C.ink2,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}
            >
              {message.text}
            </div>
          )}
        </div>

        {cfg && (
          <div
            style={{
              padding: '12px 16px',
              borderTop: `1px solid ${C.line}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 4
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: F.small,
                  letterSpacing: '0.08em',
                  color: C.dim2,
                  fontWeight: 600
                }}
              >
                設定
              </span>
              <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint }}>{cfg.path}</span>
              {!cfg.exists && (
                <span style={{ fontSize: F.micro, color: C.faint }}>
                  （未作成・既定で動いています）
                </span>
              )}
            </div>
            <span style={{ fontSize: F.small, color: C.faint, lineHeight: 1.6 }}>
              Forgejo の場所・リポジトリの探索先・remote 名をここで変えられます。 Docker
              で動かしているなら forgejoWorkPaths を空にして forgejoUrl を書きます。
            </span>
            {cfg.ignored.length > 0 && (
              <span style={{ fontSize: F.small, color: C.amber }}>
                読めずに既定へ倒した項目: {cfg.ignored.join(', ')}
              </span>
            )}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderTop: `1px solid ${C.line}`
          }}
        >
          <span style={{ fontSize: F.body, color: ready ? C.teal : C.dim2 }}>
            {ready ? '準備できています' : '必須の項目が残っています（任意の項目は数えません）'}
          </span>
          <div style={{ flexGrow: 1 }} />
          <Button onClick={onClose}>閉じる</Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Forgejo に溜まったトークンの一覧。
 *
 * **Izuna は発行するたびに 1 本増やす。** 同じ名前は作れないので時刻を混ぜており、
 * 作り直すほど溜まる。溜めた本人が片付けられないのは筋が通らない。
 *
 * ただし**ここから消せない** —— `DELETE /users/{u}/tokens/{id}` は
 * `auth method not allowed` を返す（パスワード認証が要る。実測 2026-09-08）。
 * だから**見せるところまで**をやり、消すのは Forgejo の画面に任せる。
 */
function Tokens({ onPreview }: { onPreview?: (url: string) => void }): React.JSX.Element | null {
  const [data, setData] = useState<{
    tokens: ForgejoToken[]
    mineLast8: string | null
    settingsUrl: string
  } | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void window.izuna
      .forgeTokens()
      .then(setData)
      .catch(() => setData(null))
  }, [])
  if (!data || data.tokens.length === 0) return null

  const stale = data.tokens.filter((t) => !t.last8 || !data.mineLast8 || t.last8 !== data.mineLast8)

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R.md, overflow: 'hidden' }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: S.md,
          padding: `${S.lg}px ${S.lg}px`,
          cursor: 'pointer'
        }}
      >
        <span style={{ font: `${F.small}px ${MONO}`, color: C.faint, width: 9 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ fontSize: F.body }}>トークン {data.tokens.length} 件</span>
        {stale.length > 0 && (
          <span style={{ fontSize: F.small, color: C.dim2 }}>
            使っていないもの {stale.length} 件
          </span>
        )}
      </div>

      {open && (
        <div
          style={{
            borderTop: `1px solid ${C.line}`,
            padding: S.lg,
            display: 'flex',
            flexDirection: 'column',
            gap: S.md
          }}
        >
          {data.tokens.map((t) => {
            const mine = data.mineLast8 !== null && t.last8 === data.mineLast8
            return (
              // **記号に説明を付けない。** 読めば分かる札を行に置く
              <div key={t.id} style={{ display: 'flex', alignItems: 'baseline', gap: S.md }}>
                <span style={{ font: `${F.small}px ${MONO}`, color: C.ink2, ...ellipsis }}>
                  {t.name}
                </span>
                {mine && <Tag>使用中</Tag>}
                <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, flexShrink: 0 }}>
                  …{t.last8}
                </span>
                <div style={{ flexGrow: 1 }} />
                <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, flexShrink: 0 }}>
                  {t.scopes.join(' ')}
                </span>
              </div>
            )
          })}
          {/* 消すのは Forgejo の頁。中で開ければ中で、開けなければ外のブラウザで */}
          {onPreview ? (
            <Button size="sm" onClick={() => onPreview(data.settingsUrl)}>
              Forgejo で消す
            </Button>
          ) : (
            <a
              href={data.settingsUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: F.small, color: C.teal, textDecoration: 'none' }}
            >
              Forgejo で消す
            </a>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * ボットから見える sandbox の一覧。
 *
 * **Izuna は消さない**（ボットのトークンに削除の権限を持たせない。§26）。
 * 消すのは Forgejo の設定の頁で、それを窓の中で開く（§32）。使い捨ての sandbox が
 * 溜まったとき、Izuna を出ずに片付けられる。頁の中でログインが要る（`Preview` の註）。
 */
function Repos({ onPreview }: { onPreview?: (url: string) => void }): React.JSX.Element | null {
  const [repos, setRepos] = useState<ForgejoRepo[] | null>(null)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)

  const load = useCallback(async () => {
    setRepos(await window.izuna.forgeRepos().catch(() => null))
  }, [])
  useEffect(() => {
    // 取ってきてから setState する（await の後）。同期の setState ではない
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])
  if (!repos || repos.length === 0) return null

  // 消すのはボットの下のものだけ（main の `deleteRepo` も同じ線で断る）。確認してから
  const remove = async (r: ForgejoRepo): Promise<void> => {
    setBusy(r.fullName)
    setMsg(null)
    try {
      setMsg({ text: await window.izuna.forgeDeleteRepo(r.owner, r.name), bad: false })
      setConfirming(null)
      await load()
    } catch (e) {
      setMsg({ text: String(e).replace(/^Error:\s*/, ''), bad: true })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R.md, overflow: 'hidden' }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: S.md,
          padding: `${S.lg}px ${S.lg}px`,
          cursor: 'pointer'
        }}
      >
        <span style={{ font: `${F.small}px ${MONO}`, color: C.faint, width: 9 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ fontSize: F.body }}>sandbox {repos.length} 件</span>
        <span style={{ fontSize: F.small, color: C.dim2 }}>ボットの下にあるもの。使い捨て</span>
      </div>

      {open && (
        <div
          style={{
            borderTop: `1px solid ${C.line}`,
            padding: S.lg,
            display: 'flex',
            flexDirection: 'column',
            gap: S.md
          }}
        >
          {repos.map((r) => (
            <div key={r.fullName} style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: S.md }}>
                <span style={{ font: `${F.small}px ${MONO}`, color: C.ink2, ...ellipsis }}>
                  {r.fullName}
                </span>
                {r.empty && <Tag>空</Tag>}
                <div style={{ flexGrow: 1 }} />
                {onPreview && (
                  <Button size="sm" onClick={() => onPreview(r.htmlUrl)}>
                    頁
                  </Button>
                )}
                {confirming !== r.fullName && (
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => setConfirming(r.fullName)}
                  >
                    消す
                  </Button>
                )}
              </div>
              {confirming === r.fullName && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: S.md,
                    background: C.amberBg,
                    border: `1px solid ${C.amberLine}`,
                    borderRadius: R.md,
                    padding: `${S.sm}px ${S.md}px`
                  }}
                >
                  <span style={{ fontSize: F.small, color: C.ink2 }}>
                    {r.fullName} を Forgejo から消します。PR と Actions の記録も消え、戻せません
                  </span>
                  <div style={{ flexGrow: 1 }} />
                  <Button
                    size="sm"
                    kind="primary"
                    disabled={busy !== null}
                    onClick={() => void remove(r)}
                  >
                    {busy === r.fullName ? '消しています…' : '消す'}
                  </Button>
                  <Button size="sm" onClick={() => setConfirming(null)}>
                    やめる
                  </Button>
                </div>
              )}
            </div>
          ))}
          {msg && (
            <span style={{ fontSize: F.small, color: msg.bad ? C.red : C.dim2 }}>{msg.text}</span>
          )}
        </div>
      )}
    </div>
  )
}
