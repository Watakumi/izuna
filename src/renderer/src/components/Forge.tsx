import { useCallback, useEffect, useState } from 'react'
import type { ForgejoPull } from '../../../main/forge/client'
import type { GitHubIssue } from '../../../main/forge/github'
import { rolesIn, stageOf, type RemoteRef } from '../../../shared/remote'
import { C, MONO } from '../theme'

/**
 * 二段の PR（docs/GOAL.md 柱2）。
 *
 * ```
 * 実行役 ─→ Forgejo で PR ─[人間がまとめて見る]─→ GitHub で PR
 *           荒れてよい                        仕上がったものだけ
 * ```
 *
 * **GitHub に出るのは二段目だけ。** 作業ブランチも一段目の PR も漏らさない
 * （GOAL.md 測り方）。画面もその形にする。
 */
export function Forge({ cwd, onClose }: { cwd: string; onClose: () => void }): React.JSX.Element {
  const [remotes, setRemotes] = useState<RemoteRef[]>([])
  const [branch, setBranch] = useState<string | null>(null)
  const [pushed, setPushed] = useState(false)
  const [pulls, setPulls] = useState<ForgejoPull[]>([])
  const [issues, setIssues] = useState<GitHubIssue[]>([])
  const [gh, setGh] = useState<{ ok: boolean; detail: string } | null>(null)
  const [commits, setCommits] = useState<string[]>([])
  // **main と決め打たない。** master や develop のリポジトリで PR が作れなくなる
  const [bases, setBases] = useState<{ sandbox: string | null; upstream: string | null }>(
    { sandbox: null, upstream: null }
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)

  const load = useCallback(async () => {
    const [rs, br, status] = await Promise.all([
      window.izuna.remotes(cwd),
      window.izuna.currentBranch(cwd),
      window.izuna.ghStatus(cwd)
    ])
    setRemotes(rs)
    setBranch(br)
    setGh(status)

    const { sandbox: sb, upstream: up } = rolesIn(rs)
    const [sandboxBase, upstreamBase] = await Promise.all([
      sb ? window.izuna.defaultBranch(cwd, sb.name).catch(() => null) : Promise.resolve(null),
      up ? window.izuna.defaultBranch(cwd, up.name).catch(() => null) : Promise.resolve(null)
    ])
    setBases({ sandbox: sandboxBase, upstream: upstreamBase })

    const { sandbox } = rolesIn(rs)
    if (sandbox && br) {
      setPushed(await window.izuna.isPushed(cwd, sandbox.name, br).catch(() => false))
      if (sandbox.owner && sandbox.repo) {
        setPulls(await window.izuna.forgePulls(sandbox.owner, sandbox.repo).catch(() => []))
      }
    }
    if (status.ok) {
      setIssues(await window.izuna.ghIssues(cwd).catch(() => []))
      // 出口の既定ブランチからの差分。origin と決め打たない
      const base = up && upstreamBase ? `${up.name}/${upstreamBase}` : 'HEAD~10'
      setCommits(await window.izuna.commitsSince(cwd, base).catch(() => []))
    }
  }, [cwd])

  useEffect(() => { void load() }, [load])

  const act = async (key: string, work: () => Promise<string>): Promise<void> => {
    setBusy(key)
    setMsg(null)
    try {
      setMsg({ text: await work(), bad: false })
      await load()
    } catch (e) {
      setMsg({ text: String(e).replace(/^Error:\s*/, ''), bad: true })
    } finally {
      setBusy(null)
    }
  }

  const { sandbox, upstream } = rolesIn(remotes)
  const stage = stageOf({ remotes, pushedToSandbox: pushed })

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.62)',
      zIndex: 40, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 1020, maxHeight: '82vh',
        background: C.surface, border: `1px solid ${C.line2}`, borderRadius: 13,
        boxShadow: '0 28px 80px rgba(0,0,0,0.62)', display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.line}`,
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 600 }}>Forge</span>
          <span style={{ font: `11px ${MONO}`, color: C.dim2 }}>{branch ?? '(detached)'}</span>
          <span style={{ fontSize: 11.5, color: C.faint }}>Sandbox → Upstream</span>
          <div style={{ flexGrow: 1 }} />
          <button onClick={() => void load()} style={GHOST}>読み直す</button>
          <button onClick={onClose} style={GHOST}>閉じる</button>
        </div>

        <div style={{ flexGrow: 1, minHeight: 0, display: 'flex' }}>
          {/* 作業場 */}
          <div style={{ flexGrow: 1, minWidth: 0, borderRight: `1px solid ${C.line}`,
            display: 'flex', flexDirection: 'column' }}>
            <Head dot={sandbox ? C.teal : C.faint} title="Sandbox"
              sub={sandbox?.host ?? '未設定'} note="荒れてよい・壊れたら作り直す" />

            <div style={PANE}>
              {!sandbox ? (
                <Empty text="Forgejo の remote がありません。ここを sandbox にすると、作業ブランチが GitHub に漏れなくなります">
                  <button disabled={busy !== null} style={BTN}
                    onClick={() => void act('remote', async () => {
                      const name = upstream?.repo ?? cwd.split('/').pop() ?? 'repo'
                      const repo = await window.izuna.forgeEnsureRepo(name)
                      return window.izuna.ensureSandboxRemote(cwd, repo.owner, repo.name)
                    })}>
                    {busy === 'remote' ? '用意しています…' : 'sandbox を用意する'}
                  </button>
                </Empty>
              ) : (
                <>
                  {!pushed && branch && (
                    <Row>
                      <span style={{ fontSize: 12.5, color: C.dim }}>{branch} はまだ sandbox にありません</span>
                      <div style={{ flexGrow: 1 }} />
                      <button disabled={busy !== null} style={BTN}
                        onClick={() => void act('push', () => window.izuna.push(cwd, sandbox.name, branch))}>
                        {busy === 'push' ? 'push 中…' : `${sandbox.name} に push`}
                      </button>
                    </Row>
                  )}

                  {pulls.length === 0 && pushed && branch && (
                    <Row>
                      <span style={{ fontSize: 12.5, color: C.dim }}>まとめて見るための PR を作れます</span>
                      <div style={{ flexGrow: 1 }} />
                      <button disabled={busy !== null} style={BTN}
                        onClick={() => void act('pr', async () => {
                          const pr = await window.izuna.forgeCreatePull(sandbox.owner!, sandbox.repo!, {
                            title: branch, head: branch,
                            base: bases.sandbox ?? bases.upstream ?? 'main',
                            body: commits.length ? commits.map((c) => `- ${c}`).join('\n') : ''
                          })
                          return `sandbox に PR !${pr.number} を作りました`
                        })}>
                        {busy === 'pr' ? '作成中…' : 'sandbox で PR を作る'}
                      </button>
                    </Row>
                  )}

                  {pulls.map((p) => (
                    <div key={p.number} style={CARD}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ font: `11.5px ${MONO}`, color: C.dim2 }}>!{p.number}</span>
                        <span style={{ fontSize: 12.5, flexGrow: 1, minWidth: 0, overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                        {p.draft && <span style={{ fontSize: 10.5, color: C.faint }}>下書き</span>}
                      </div>
                      <span style={{ font: `11px ${MONO}`, color: C.dim2 }}>{p.head} → {p.base}</span>
                    </div>
                  ))}
                  {pulls.length === 0 && !pushed && <Empty text="push してから PR を作ります" />}
                </>
              )}
            </div>
          </div>

          {/* 受け渡し */}
          <div style={{ width: 54, flexShrink: 0, background: C.panel, display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke={stage === 'readyForUpstream' ? C.amber : C.faint} strokeWidth="1.8" strokeLinecap="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
            <span style={{ fontSize: 10, color: C.faint, writingMode: 'vertical-rl', letterSpacing: '0.12em' }}>
              通ったものだけ
            </span>
          </div>

          {/* 出口 */}
          <div style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <Head dot={gh?.ok ? C.teal : C.red} title="Upstream"
              sub={gh?.ok ? gh.detail : 'gh が使えません'} note="仕上がったものだけ" />

            <div style={PANE}>
              {!gh?.ok && <Empty text={gh?.detail ?? '確認しています…'} />}
              {gh?.ok && (
                <>
                  {branch && (
                    <div style={{ ...CARD, borderColor: C.amberLine, background: C.amberBg }}>
                      <span style={{ font: `12px ${MONO}` }}>
                        {branch} → {bases.upstream ?? '(既定ブランチ不明)'}
                      </span>
                      <span style={{ fontSize: 11.5, color: C.dim2 }}>
                        {commits.length ? `${commits.length} コミット` : '差分の取得に失敗しました'}
                      </span>
                      <button disabled={busy !== null || stage !== 'readyForUpstream'} style={{ ...BTN,
                        opacity: stage === 'readyForUpstream' ? 1 : 0.45 }}
                        onClick={() => void act('gh', () => window.izuna.ghCreatePull(cwd, {
                          title: branch, head: branch,
                          ...(bases.upstream ? { base: bases.upstream } : {}),
                          body: commits.map((c) => `- ${c}`).join('\n') || '（本文なし）'
                        }))}>
                        {busy === 'gh' ? '作成中…' : 'GitHub に PR を作る'}
                      </button>
                      {stage !== 'readyForUpstream' && (
                        <span style={{ fontSize: 11, color: C.faint }}>
                          先に sandbox で見てください（{stage === 'needsSandbox' ? 'sandbox が未設定' : 'push が未了'}）
                        </span>
                      )}
                    </div>
                  )}

                  <span style={LABEL}>元になる Issue</span>
                  {issues.length === 0 && <Empty text="open な Issue はありません" />}
                  {issues.slice(0, 6).map((i) => (
                    <div key={i.number} style={CARD}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ font: `11.5px ${MONO}`, color: C.dim2 }}>#{i.number}</span>
                        <span style={{ fontSize: 12.5, flexGrow: 1, minWidth: 0, overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        {msg && (
          <div style={{ padding: '11px 18px', borderTop: `1px solid ${C.line}`, fontSize: 12,
            color: msg.bad ? C.red : C.ink2, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  )
}

function Head({ dot, title, sub, note }: { dot: string; title: string; sub: string; note: string }): React.JSX.Element {
  return (
    <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
      padding: '0 16px', borderBottom: `1px solid ${C.line}`, background: C.panel }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />
      <span style={{ fontWeight: 600, fontSize: 12.5 }}>{title}</span>
      <span style={{ font: `11px ${MONO}`, color: C.dim2, minWidth: 0, overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
      <div style={{ flexGrow: 1 }} />
      <span style={{ fontSize: 10.5, color: C.faint, flexShrink: 0 }}>{note}</span>
    </div>
  )
}

function Empty({ text, children }: { text: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 2px' }}>
      <span style={{ fontSize: 12, color: C.faint, lineHeight: 1.7 }}>{text}</span>
      {children}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={{ ...CARD, flexDirection: 'row', alignItems: 'center' }}>{children}</div>
}

const PANE: React.CSSProperties = {
  flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: 14,
  display: 'flex', flexDirection: 'column', gap: 9
}
const CARD: React.CSSProperties = {
  border: `1px solid ${C.line2}`, borderRadius: 9, padding: '11px 13px',
  display: 'flex', flexDirection: 'column', gap: 7
}
const LABEL: React.CSSProperties = {
  fontSize: 11, letterSpacing: '0.08em', color: C.dim2, fontWeight: 600, paddingTop: 4
}
const BTN: React.CSSProperties = {
  padding: '7px 15px', borderRadius: 7, border: 'none', background: C.amber,
  color: C.amberInk, fontWeight: 600, fontSize: 12, cursor: 'pointer', alignSelf: 'flex-start'
}
const GHOST: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 7, border: `1px solid ${C.line2}`,
  background: 'transparent', color: C.ink2, fontSize: 12, cursor: 'pointer'
}
