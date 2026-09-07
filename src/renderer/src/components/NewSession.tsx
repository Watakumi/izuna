import { useEffect, useState } from 'react'
import type { RepoInfo } from '../../../shared/ipc'
import type { FoundRepo } from '../../../main/repos'
import type { GitHubIssue } from '../../../main/forge/github'
import { branchFromIssue, branchFromText, uniqueBranch } from '../../../shared/branch'
import { validateNewWorktree, worktreePathFor } from '../../../shared/worktree'
import { C, MONO } from '../theme'

/**
 * セッションを起こす（段3・段4 の入口）。
 *
 * **人間に worktree を作らせない。** 人が考えるのは「この Issue をやりたい」
 * であって、worktree を作るかどうかでもブランチ名でもない。
 * worktree もブランチも**結果**なので、自動で決めて、詳細に畳む。
 *
 * 順番も直した。以前は「場所 → 方式 → ブランチ名」で、**やることを最後まで
 * 聞かなかった**。docs/GOAL.md の 7 手は Issue から始まるのに、その入口が
 * 画面に無かった。
 */
export interface StartInput {
  cwd: string
  label: string
  branch: string | null
  team: string
  /** 起こしたあとに最初に送る依頼。空なら送らない */
  initialPrompt: string
}

export function NewSession({
  initialCwd,
  onCancel,
  onStart
}: {
  initialCwd: string
  onCancel: () => void
  onStart: (input: StartInput) => Promise<void>
}): React.JSX.Element {
  const [cwd, setCwd] = useState(initialCwd)
  const [found, setFound] = useState<FoundRepo[] | null>(null)
  const [query, setQuery] = useState('')
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [repoError, setRepoError] = useState<string | null>(null)

  const [issues, setIssues] = useState<GitHubIssue[] | null>(null)
  const [issue, setIssue] = useState<GitHubIssue | null>(null)
  const [text, setText] = useState('')

  const [showDetail, setShowDetail] = useState(false)
  const [branchOverride, setBranchOverride] = useState<string | null>(null)
  const [useWorktree, setUseWorktree] = useState(true)

  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => { void window.izuna.findRepos().then(setFound).catch(() => setFound([])) }, [])

  // リポジトリが決まったら、やることの候補（Issue）を引く
  useEffect(() => {
    const path = cwd.trim()
    if (!path) { setRepo(null); setIssues(null); return }
    let alive = true
    const timer = setTimeout(() => {
      window.izuna.repo(path)
        .then((r) => { if (alive) { setRepo(r); setRepoError(null) } })
        .catch((e) => {
          if (!alive) return
          setRepo(null)
          setRepoError(String(e).replace(/^Error:\s*/, ''))
          setUseWorktree(false)
        })
      window.izuna.ghIssues(path).then((v) => { if (alive) setIssues(v) }).catch(() => { if (alive) setIssues(null) })
    }, 300)
    return () => { alive = false; clearTimeout(timer) }
  }, [cwd])

  const matches = (found ?? []).filter((r) => {
    const q = query.trim().toLowerCase()
    return q === '' || r.name.toLowerCase().includes(q) || r.group.toLowerCase().includes(q)
  })

  // ブランチ名は**やること**から決まる。人が考えない
  const taken = (repo?.worktrees ?? []).flatMap((w) => (w.branch ? [w.branch] : []))
  const auto = issue
    ? branchFromIssue(issue.number, issue.title)
    : text.trim()
      ? branchFromText(text)
      : ''
  const branch = branchOverride ?? (auto ? uniqueBranch(auto, taken) : '')

  const prompt = issue
    ? `GitHub の Issue #${issue.number}「${issue.title}」に取り組んでください。\n${issue.url}`
    : text.trim()

  const problem = repo && useWorktree && branch
    ? validateNewWorktree(repo.worktrees, branch, worktreePathFor('', repo.name, branch))
    : null
  const ready = !busy && cwd.trim() !== '' && prompt !== '' && (!useWorktree || (branch !== '' && !problem))

  const start = async (): Promise<void> => {
    if (!ready) return
    setBusy(true)
    setFailure(null)
    try {
      if (repo && useWorktree) {
        const created = await window.izuna.createWorktree(repo.root, branch)
        await onStart({ cwd: created.path, label: issue ? `#${issue.number} ${issue.title}` : branch,
          branch: created.branch, team: created.branch, initialPrompt: prompt })
      } else {
        const base = repo?.root ?? cwd.trim()
        const name = repo?.name ?? base.split('/').filter(Boolean).pop() ?? base
        await onStart({ cwd: base, label: name, branch: null, team: name, initialPrompt: prompt })
      }
    } catch (e) {
      setFailure(String(e).replace(/^Error:\s*/, ''))
      setBusy(false)
    }
  }

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.62)',
      zIndex: 40, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 64 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 660, maxHeight: '84vh',
        background: C.surface, border: `1px solid ${C.line2}`, borderRadius: 13,
        boxShadow: '0 28px 80px rgba(0,0,0,0.62)', display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '15px 18px', borderBottom: `1px solid ${C.line}`, fontWeight: 600 }}>
          新しいセッション
        </div>

        <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: 18,
          display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 1. どこで */}
          <Section label="どのリポジトリ" action={
            <button style={LINK} onClick={() => void window.izuna.pickDirectory()
              .then((p) => { if (p) { setCwd(p); setQuery(''); setIssue(null) } })}>
              フォルダを選ぶ…
            </button>
          }>
            {found === null && <Faint>探しています…</Faint>}
            {found !== null && (
              <>
                <input value={query} spellCheck={false} placeholder={`${found.length} 本から絞り込む`}
                  onChange={(e) => setQuery(e.target.value)} style={INPUT} />
                <div style={{ maxHeight: 132, overflowY: 'auto', border: `1px solid ${C.line}`,
                  borderRadius: 7, display: 'flex', flexDirection: 'column' }}>
                  {matches.slice(0, 60).map((r) => (
                    <div key={r.path} onClick={() => { setCwd(r.path); setIssue(null); setBranchOverride(null) }}
                      style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 12px',
                        cursor: 'pointer', borderLeft: `2px solid ${r.path === cwd ? C.amber : 'transparent'}`,
                        background: r.path === cwd ? C.raised : 'transparent' }}>
                      <span style={{ fontSize: 12.5, color: r.path === cwd ? C.ink : C.ink2 }}>{r.name}</span>
                      <span style={{ font: `10.5px ${MONO}`, color: C.faint, flexGrow: 1,
                        textAlign: 'right', minWidth: 0, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.group}</span>
                    </div>
                  ))}
                  {matches.length === 0 && <Faint style={{ padding: '11px 12px' }}>当たるものがありません</Faint>}
                </div>
              </>
            )}
            {repoError && <span style={{ fontSize: 11.5, color: C.amber, lineHeight: 1.6 }}>{repoError}</span>}
          </Section>

          {/* 2. 何をするか —— ここが本題 */}
          {cwd.trim() !== '' && (
            <Section label="何をするか">
              {issues && issues.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {issues.slice(0, 5).map((i) => (
                    <div key={i.number} onClick={() => { setIssue(i); setText(''); setBranchOverride(null) }}
                      style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 12px',
                        borderRadius: 7, cursor: 'pointer',
                        border: `1px solid ${issue?.number === i.number ? C.amberLine : C.line}`,
                        background: issue?.number === i.number ? C.amberBg : 'transparent' }}>
                      <span style={{ font: `11px ${MONO}`, color: C.dim2, flexShrink: 0 }}>#{i.number}</span>
                      <span style={{ fontSize: 12.5, color: C.ink2, minWidth: 0, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
                    </div>
                  ))}
                </div>
              )}
              {issues !== null && issues.length === 0 && <Faint>open な Issue はありません</Faint>}
              {issues === null && cwd.trim() !== '' && <Faint>GitHub に繋がっていません。下に直接書けます</Faint>}

              <textarea
                value={text} rows={2} spellCheck={false}
                placeholder={issues && issues.length > 0 ? 'または、やることを直接書く' : 'やることを書く'}
                onChange={(e) => { setText(e.target.value); setIssue(null); setBranchOverride(null) }}
                style={{ ...INPUT, font: `13px/1.6 inherit`, resize: 'none' }}
              />
            </Section>
          )}

          {/* 3. 詳細 —— 既定で畳む。worktree もブランチ名も結果 */}
          {branch !== '' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div onClick={() => setShowDetail((v) => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                <span style={{ font: `10px ${MONO}`, color: C.faint, width: 8 }}>{showDetail ? '▾' : '▸'}</span>
                <span style={{ fontSize: 11.5, color: C.dim2 }}>詳細</span>
                <span style={{ font: `11px ${MONO}`, color: problem ? C.red : C.faint,
                  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {useWorktree ? `worktree ${branch}` : 'このディレクトリで直接'}
                </span>
              </div>

              {showDetail && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 17 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={useWorktree} disabled={!repo}
                      onChange={(e) => setUseWorktree(e.target.checked)} />
                    worktree を作る
                    {!repo && <span style={{ fontSize: 11, color: C.faint }}>（git リポジトリのみ）</span>}
                  </label>
                  {useWorktree && (
                    <>
                      <input value={branch} spellCheck={false}
                        onChange={(e) => setBranchOverride(e.target.value)}
                        style={{ ...INPUT, borderColor: problem ? C.red : C.line2 }} />
                      {problem
                        ? <span style={{ fontSize: 11.5, color: C.red }}>{problem}</span>
                        : <span style={{ font: `10.5px ${MONO}`, color: C.faint }}>
                            {worktreePathFor('~/.izuna/worktrees', repo?.name ?? '?', branch)}
                          </span>}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {failure && (
            <div style={{ border: `1px solid ${C.red}`, borderRadius: 7, padding: '9px 12px',
              fontSize: 11.5, color: C.red, whiteSpace: 'pre-wrap' }}>{failure}</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 18px',
          borderTop: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 11, color: C.faint }}>
            {ready ? '起こすと、選んだ内容がそのまま最初の依頼になります' : ''}
          </span>
          <div style={{ flexGrow: 1 }} />
          <button onClick={onCancel} style={GHOST}>やめる</button>
          <button onClick={() => void start()} disabled={!ready} style={{ ...BTN, opacity: ready ? 1 : 0.45 }}>
            {busy ? '用意しています…' : '起こす'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ label, action, children }: {
  label: string; action?: React.ReactNode; children: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.08em', color: C.dim2, fontWeight: 600 }}>{label}</span>
        <div style={{ flexGrow: 1 }} />
        {action}
      </div>
      {children}
    </div>
  )
}

const Faint = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): React.JSX.Element =>
  <span style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.7, ...style }}>{children}</span>

const INPUT: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 7, border: `1px solid ${C.line2}`,
  background: C.bg, color: C.ink, font: `12px ${MONO}`, outline: 'none'
}
const BTN: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 7, border: 'none', background: C.amber,
  color: C.amberInk, fontWeight: 600, fontSize: 12.5, cursor: 'pointer'
}
const GHOST: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 7, border: `1px solid ${C.line2}`,
  background: 'transparent', color: C.ink2, fontSize: 12.5, cursor: 'pointer'
}
const LINK: React.CSSProperties = {
  padding: '4px 11px', borderRadius: 6, border: `1px solid ${C.line2}`,
  background: 'transparent', color: C.ink2, fontSize: 11.5, cursor: 'pointer'
}
