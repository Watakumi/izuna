import { useCallback, useEffect, useState } from 'react'
import type { ForgejoPull } from '../../../main/forge/client'
import type { GitHubIssue } from '../../../main/forge/github'
import { rolesIn, stageOf, type RemoteRef } from '../../../shared/remote'
import { C, F, MONO, S, ellipsis } from '../theme'
import { Button, Card, Faint } from './ui'

/**
 * 右ペインの「PR」タブ。二段の PR（docs/GOAL.md 柱2）。
 *
 * ```
 * 実行役 ─→ Sandbox の PR ─[人間がまとめて見る]─→ Upstream の PR
 * ```
 *
 * **モーダルにしない。** 会話と行き来しながら使う画面なので、
 * 横に並べて見られる必要がある。狭い縦の柱なので上下に積む。
 */
export function Forge({ cwd, onDone }: { cwd: string; onDone: () => void }): React.JSX.Element {
  const [remotes, setRemotes] = useState<RemoteRef[]>([])
  const [branch, setBranch] = useState<string | null>(null)
  const [pushed, setPushed] = useState(false)
  const [pulls, setPulls] = useState<ForgejoPull[]>([])
  const [issues, setIssues] = useState<GitHubIssue[]>([])
  const [gh, setGh] = useState<{ ok: boolean; detail: string } | null>(null)
  const [commits, setCommits] = useState<string[]>([])
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
    // **main と決め打たない。** master や develop で PR が作れなくなる
    const [sandboxBase, upstreamBase] = await Promise.all([
      sb ? window.izuna.defaultBranch(cwd, sb.name).catch(() => null) : Promise.resolve(null),
      up ? window.izuna.defaultBranch(cwd, up.name).catch(() => null) : Promise.resolve(null)
    ])
    setBases({ sandbox: sandboxBase, upstream: upstreamBase })

    if (sb && br) {
      setPushed(await window.izuna.isPushed(cwd, sb.name, br).catch(() => false))
      if (sb.owner && sb.repo) setPulls(await window.izuna.forgePulls(sb.owner, sb.repo).catch(() => []))
    }
    if (status.ok) {
      setIssues(await window.izuna.ghIssues(cwd).catch(() => []))
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>

      {/* Sandbox */}
      <Head dot={sandbox ? C.teal : C.faint} title="Sandbox"
        sub={sandbox?.host ?? '未設定'} note="荒れてよい" />
      <div style={{ padding: S.lg, display: "flex", flexDirection: "column", gap: S.md }}>
        {!sandbox ? (
          <>
            <Faint>Forgejo の remote がありません。ここを sandbox にすると、作業ブランチが Upstream に漏れなくなります</Faint>
            <Button disabled={busy !== null} kind="primary"
              onClick={() => void act('remote', async () => {
                const name = upstream?.repo ?? cwd.split('/').pop() ?? 'repo'
                const repo = await window.izuna.forgeEnsureRepo(name)
                return window.izuna.ensureSandboxRemote(cwd, repo.owner, repo.name)
              })}>
              {busy === 'remote' ? '用意しています…' : 'sandbox を用意する'}
            </Button>
          </>
        ) : (
          <>
            {!pushed && branch && (
              <>
                <Faint>{branch} はまだ sandbox にありません</Faint>
                <Button disabled={busy !== null} kind="primary"
                  onClick={() => void act('push', () => window.izuna.push(cwd, sandbox.name, branch))}>
                  {busy === 'push' ? 'push 中…' : `${sandbox.name} に push`}
                </Button>
              </>
            )}

            {pulls.map((p) => (
              <Card key={p.number}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ font: `${F.small}px ${MONO}`, color: C.dim2 }}>!{p.number}</span>
                  <span style={{ fontSize: F.body, ...ellipsis }}>{p.title}</span>
                </div>
                <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint }}>{p.head} → {p.base}</span>
              </Card>
            ))}

            {pulls.length === 0 && pushed && branch && (
              <Button disabled={busy !== null} kind="primary"
                onClick={() => void act('pr', async () => {
                  const pr = await window.izuna.forgeCreatePull(sandbox.owner!, sandbox.repo!, {
                    title: branch, head: branch,
                    base: bases.sandbox ?? bases.upstream ?? 'main',
                    body: commits.map((c) => `- ${c}`).join('\n')
                  })
                  return `sandbox に PR !${pr.number} を作りました`
                })}>
                {busy === 'pr' ? '作成中…' : 'sandbox で PR を作る'}
              </Button>
            )}
          </>
        )}
      </div>

      {/* 受け渡し */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '12px 0', background: C.panel, borderTop: `1px solid ${C.line}`,
        borderBottom: `1px solid ${C.line}` }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
          stroke={stage === 'readyForUpstream' ? C.amber : C.faint} strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
        <span style={{ fontSize: F.micro, color: C.faint }}>通ったものだけ</span>
      </div>

      {/* Upstream */}
      <Head dot={gh?.ok ? C.teal : C.red} title="Upstream"
        sub={gh?.ok ? gh.detail : 'gh が使えません'} note="仕上がったものだけ" />
      <div style={{ padding: S.lg, display: "flex", flexDirection: "column", gap: S.md }}>
        {!gh?.ok && <Faint>{gh?.detail ?? '確認しています…'}</Faint>}
        {gh?.ok && branch && (
          <Card tone="attention">
            <span style={{ font: `${F.small}px ${MONO}` }}>
              {branch} → {bases.upstream ?? '(既定ブランチ不明)'}
            </span>
            <span style={{ fontSize: F.small, color: C.dim2 }}>
              {commits.length ? `${commits.length} コミット` : '差分がありません'}
            </span>
            <Button disabled={busy !== null || stage !== 'readyForUpstream'}
              kind="primary"
              onClick={() => void act('gh', async () => {
                const url = await window.izuna.ghCreatePull(cwd, {
                  title: branch, head: branch,
                  ...(bases.upstream ? { base: bases.upstream } : {}),
                  body: commits.map((c) => `- ${c}`).join('\n') || '（本文なし）'
                })
                onDone()
                return url
              })}>
              {busy === 'gh' ? '作成中…' : 'Upstream に PR を作る'}
            </Button>
            {stage !== 'readyForUpstream' && (
              <span style={{ fontSize: F.micro, color: C.faint, lineHeight: 1.6 }}>
                先に sandbox で見てください（{stage === 'needsSandbox' ? 'sandbox が未設定' : 'push が未了'}）
              </span>
            )}
          </Card>
        )}

        {gh?.ok && issues.length > 0 && (
          <>
            <span style={{ fontSize: F.small, letterSpacing: "0.08em", color: C.dim2, fontWeight: 600 }}>元になる Issue</span>
            {issues.slice(0, 4).map((i) => (
              <Card key={i.number}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ font: `${F.small}px ${MONO}`, color: C.dim2 }}>#{i.number}</span>
                  <span style={{ fontSize: F.body, ...ellipsis }}>{i.title}</span>
                </div>
              </Card>
            ))}
          </>
        )}
      </div>

      {msg && (
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.line}`, fontSize: F.small,
          color: msg.bad ? C.red : C.ink2, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {msg.text}
        </div>
      )}
    </div>
  )
}

function Head({ dot, title, sub, note }: { dot: string; title: string; sub: string; note: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
      background: C.panel, borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ fontWeight: 600, fontSize: F.body }}>{title}</span>
      <span style={{ font: `${F.micro}px ${MONO}`, color: C.dim2, ...ellipsis }}>{sub}</span>
      <div style={{ flexGrow: 1 }} />
      <span style={{ fontSize: F.micro, color: C.faint, flexShrink: 0 }}>{note}</span>
    </div>
  )
}


