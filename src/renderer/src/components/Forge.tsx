import { useCallback, useEffect, useState } from 'react'
import type { ForgejoPull } from '../../../main/forge/client'
import type { GitHubIssue, GitHubPull } from '../../../main/forge/github'
import { rolesIn, stageOf, type RemoteRef } from '../../../shared/remote'
import { makeCache } from '../remember'
import { C, F, MONO, S, ellipsis } from '../theme'
import { Button, Card, Faint, Result } from './ui'

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
/** 一度読んだものは覚えておく（`remember.ts` の註）。鍵は作業ディレクトリ */
interface Snapshot {
  remotes: RemoteRef[]
  branch: string | null
  pushed: boolean
  pulls: ForgejoPull[]
  issues: GitHubIssue[]
  ghPulls: GitHubPull[]
  gh: { ok: boolean; detail: string } | null
  commits: string[]
  bases: { sandbox: string | null; upstream: string | null }
}
const remembered = makeCache<Snapshot>()

export function Forge({ cwd, sessionId, onDone }: {
  cwd: string
  /** レビューを流し込む先。会話が無ければ頼めない */
  sessionId: string | null
  onDone: () => void
}): React.JSX.Element {
  /**
   * **「まだ読んでいない」と「読んだ結果、無い」を区別する。**
   *
   * 初期値を `[]` にしていたので、開いた瞬間だけ
   * 「Forgejo の remote がありません」が出て、すぐ消えていた。
   * 一瞬でも嘘を出すと、利用者は設定を疑って触りに行く。
   */
  const seed = remembered.get(cwd) ?? null
  const [remotes, setRemotes] = useState<RemoteRef[] | null>(seed?.remotes ?? null)
  const [branch, setBranch] = useState<string | null>(seed?.branch ?? null)
  const [pushed, setPushed] = useState(seed?.pushed ?? false)
  const [pulls, setPulls] = useState<ForgejoPull[] | null>(seed?.pulls ?? null)
  const [issues, setIssues] = useState<GitHubIssue[] | null>(seed?.issues ?? null)
  const [ghPulls, setGhPulls] = useState<GitHubPull[] | null>(seed?.ghPulls ?? null)
  const [gh, setGh] = useState<{ ok: boolean; detail: string } | null>(seed?.gh ?? null)
  const [commits, setCommits] = useState<string[] | null>(seed?.commits ?? null)
  const [bases, setBases] = useState<{ sandbox: string | null; upstream: string | null }>(
    seed?.bases ?? { sandbox: null, upstream: null }
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad: boolean; at: number } | null>(null)

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

    let nextPushed = false
    let nextPulls: ForgejoPull[] = []
    let nextIssues: GitHubIssue[] = []
    let nextGhPulls: GitHubPull[] = []
    let nextCommits: string[] = []

    if (sb && br) {
      nextPushed = await window.izuna.isPushed(cwd, sb.name, br).catch(() => false)
      if (sb.owner && sb.repo) nextPulls = await window.izuna.forgePulls(sb.owner, sb.repo).catch(() => [])
      setPushed(nextPushed)
      setPulls(nextPulls)
    }
    if (status.ok) {
      nextIssues = await window.izuna.ghIssues(cwd).catch(() => [])
      nextGhPulls = await window.izuna.ghPulls(cwd).catch(() => [])
      setGhPulls(nextGhPulls)
      const base = up && upstreamBase ? `${up.name}/${upstreamBase}` : 'HEAD~10'
      nextCommits = await window.izuna.commitsSince(cwd, base).catch(() => [])
      setIssues(nextIssues)
      setCommits(nextCommits)
    }

    remembered.set(cwd, {
      remotes: rs, branch: br, gh: status, pushed: nextPushed, pulls: nextPulls,
      issues: nextIssues, ghPulls: nextGhPulls, commits: nextCommits,
      bases: { sandbox: sandboxBase, upstream: upstreamBase }
    })
  }, [cwd])

  useEffect(() => { void load() }, [load])

  const act = async (key: string, work: () => Promise<string>): Promise<void> => {
    setBusy(key)
    setMsg(null)
    try {
      setMsg({ text: await work(), bad: false, at: Date.now() })
      await load()
    } catch (e) {
      setMsg({ text: String(e).replace(/^Error:\s*/, ''), bad: true, at: Date.now() })
    } finally {
      setBusy(null)
    }
  }

  const { sandbox, upstream } = rolesIn(remotes ?? [])

  /**
   * 見出しの右には**事実を置く**。
   *
   * 以前は「荒れてよい」「仕上がったものだけ」と書いていたが、
   * 二段であることは**あいだの矢印が既に言っている**ので重複していたし、
   * 見るたびに同じ文字が出るだけで、何も分からなかった。
   */
  const upstreamNote = [
    ghPulls === null ? null : `PR ${ghPulls.length} 件`,
    bases.upstream
  ].filter(Boolean).join(' · ')
  const stage = stageOf({ remotes: remotes ?? [], pushedToSandbox: pushed })

  // 読み終わるまでは**何も断定しない**
  if (remotes === null) {
    return (
      <div style={{ padding: S.lg }}>
        <Faint>読んでいます…</Faint>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>

      {/* Sandbox */}
      <Head dot={sandbox ? C.teal : C.faint} title="Sandbox"
        sub={sandbox?.host ?? '未設定'}
        note={pulls === null ? '' : `PR ${pulls.length} 件`} />
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
                  {busy === 'push' ? 'push しています…' : `${sandbox.name} に push`}
                </Button>
              </>
            )}

            {(pulls ?? []).map((p) => (
              <Card key={p.number}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ font: `${F.small}px ${MONO}`, color: C.dim2 }}>!{p.number}</span>
                  <span style={{ fontSize: F.body, ...ellipsis }}>{p.title}</span>
                </div>
                <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint }}>{p.head} → {p.base}</span>
              </Card>
            ))}

            {pulls?.length === 0 && pushed && branch && (
              <Button disabled={busy !== null} kind="primary"
                onClick={() => void act('pr', async () => {
                  const pr = await window.izuna.forgeCreatePull(sandbox.owner!, sandbox.repo!, {
                    title: branch, head: branch,
                    base: bases.sandbox ?? bases.upstream ?? 'main',
                    body: (commits ?? []).map((c) => `- ${c}`).join('\n')
                  })
                  return `sandbox に PR !${pr.number} を作りました`
                })}>
                {busy === 'pr' ? '作っています…' : 'sandbox で PR を作る'}
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
        <span style={{ fontSize: F.micro, color: C.faint }}>承認したものだけ</span>
      </div>

      {/* Upstream */}
      <Head dot={gh?.ok ? C.teal : C.red} title="Upstream"
        sub={gh?.ok ? gh.detail : 'gh が使えません'}
        note={upstreamNote} />
      <div style={{ padding: S.lg, display: "flex", flexDirection: "column", gap: S.md }}>
        {!gh?.ok && <Faint>{gh?.detail ?? '読んでいます…'}</Faint>}
        {gh?.ok && branch && (
          <Card tone="attention">
            <span style={{ font: `${F.small}px ${MONO}` }}>
              {branch} → {bases.upstream ?? '(既定ブランチ不明)'}
            </span>
            <span style={{ fontSize: F.small, color: C.dim2 }}>
              {/* 読み終わるまで「差分がありません」と言わない */}
              {commits === null ? '…' : commits.length ? `${commits.length} コミット` : '差分がありません'}
            </span>
            <Button disabled={busy !== null || stage !== 'readyForUpstream'}
              kind="primary"
              onClick={() => void act('gh', async () => {
                const url = await window.izuna.ghCreatePull(cwd, {
                  title: branch, head: branch,
                  ...(bases.upstream ? { base: bases.upstream } : {}),
                  body: (commits ?? []).map((c) => `- ${c}`).join('\n') || '（本文なし）'
                })
                onDone()
                return url
              })}>
              {busy === 'gh' ? '作っています…' : 'Upstream に PR を作る'}
            </Button>
            {/* **PR を作る前でもレビューは頼める。** 出す前に読むほうが安い */}
            <Button disabled={busy !== null || !bases.upstream || sessionId === null}
              onClick={() => void act('review', async () => {
                await window.izuna.requestReview(sessionId!, { base: bases.upstream! })
                onDone()
                return 'いまの会話にレビューを頼みました'
              })}>
              {busy === 'review' ? '頼んでいます…' : '差分のレビューを頼む'}
            </Button>
            {stage !== 'readyForUpstream' && (
              <span style={{ fontSize: F.micro, color: C.faint, lineHeight: 1.6 }}>
                先に sandbox で見てください（{stage === 'needsSandbox' ? 'sandbox が未設定' : 'push が未了'}）
              </span>
            )}
          </Card>
        )}

        {gh?.ok && issues && issues.length > 0 && (
          <>
            <span style={{ fontSize: F.small, letterSpacing: "0.08em", color: C.dim2, fontWeight: 600 }}>Issue</span>
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
        <div style={{ padding: S.lg, borderTop: `1px solid ${C.line}` }}>
          <Result {...msg} />
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


