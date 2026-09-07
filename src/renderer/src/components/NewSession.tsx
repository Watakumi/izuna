import { useEffect, useState } from 'react'
import type { RepoInfo } from '../../../shared/ipc'
import { slugifyBranch, validateNewWorktree, worktreePathFor } from '../../../shared/worktree'
import { C, MONO } from '../theme'

/**
 * セッションの起こし方を決める（段3）。
 *
 * 既定は **worktree を作る**。並列で走らせるのが Izuna の目的なので、
 * 同じ作業ツリーを 2 つのセッションで共有させない。
 * 直接開く道も残すが、そちらを既定にしない。
 */
export function NewSession({
  initialCwd,
  onCancel,
  onStart
}: {
  initialCwd: string
  onCancel: () => void
  onStart: (input: { cwd: string; label: string; branch: string | null }) => Promise<void>
}): React.JSX.Element {
  const [cwd, setCwd] = useState(initialCwd)
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [useWorktree, setUseWorktree] = useState(true)
  const [branch, setBranch] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // 打ち終わってからリポジトリを引く。1 文字ごとに git を叩かない
  useEffect(() => {
    const path = cwd.trim()
    if (!path) { setRepo(null); setRepoError(null); return }
    let alive = true
    const timer = setTimeout(() => {
      window.izuna.repo(path)
        .then((r) => { if (alive) { setRepo(r); setRepoError(null) } })
        .catch((e) => { if (alive) { setRepo(null); setRepoError(String(e).replace(/^Error:\s*/, '')) } })
    }, 350)
    return () => { alive = false; clearTimeout(timer) }
  }, [cwd])

  // 作る前の検査は純粋関数（shared/worktree.ts）。git を叩かずに理由が出る
  const targetPath = repo && branch.trim()
    ? worktreePathFor('~/.izuna/worktrees', repo.name, branch)
    : null
  const problem = repo && useWorktree && branch.trim()
    ? validateNewWorktree(repo.worktrees, branch.trim(), worktreePathFor('', repo.name, branch))
    : null
  const ready = !!repo && !busy && (!useWorktree || (branch.trim() !== '' && !problem))

  const start = async (): Promise<void> => {
    if (!repo || !ready) return
    setBusy(true)
    setFailure(null)
    try {
      if (useWorktree) {
        const created = await window.izuna.createWorktree(repo.root, branch.trim())
        await onStart({ cwd: created.path, label: created.branch, branch: created.branch })
      } else {
        const here = repo.worktrees.find((w) => w.path === repo.root)
        await onStart({ cwd: repo.root, label: repo.name, branch: here?.branch ?? null })
      }
    } catch (e) {
      setFailure(String(e).replace(/^Error:\s*/, ''))
      setBusy(false)
    }
  }

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.62)', zIndex: 40,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 90
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 620, background: C.surface, border: `1px solid ${C.line2}`, borderRadius: 13,
        boxShadow: '0 28px 80px rgba(0,0,0,0.62)', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ padding: '15px 18px', borderBottom: `1px solid ${C.line}`, fontWeight: 600 }}>
          新しいセッション
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={LABEL}>リポジトリ</span>
            <input autoFocus value={cwd} spellCheck={false} placeholder="リポジトリの絶対パス"
              onChange={(e) => setCwd(e.target.value)} style={INPUT} />
            {repoError && <span style={{ fontSize: 11.5, color: C.red }}>{repoError}</span>}
            {repo && (
              <span style={{ font: `11px ${MONO}`, color: C.dim2 }}>
                {repo.name} · worktree {repo.worktrees.length} 本
                {repo.worktrees.length > 1 && (
                  <> · {repo.worktrees.filter((w) => !w.main).map((w) => w.branch).join(', ')}</>
                )}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <span style={LABEL}>作業する場所</span>
            <label style={ROW}>
              <input type="radio" checked={useWorktree} onChange={() => setUseWorktree(true)} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12.5 }}>新しい worktree を作る</span>
                <span style={{ fontSize: 11, color: C.dim2 }}>並列に走らせるならこちら。互いに干渉しない</span>
              </div>
            </label>
            <label style={ROW}>
              <input type="radio" checked={!useWorktree} onChange={() => setUseWorktree(false)} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12.5 }}>このディレクトリで直接</span>
                <span style={{ fontSize: 11, color: C.dim2 }}>
                  1 本だけのとき。同じ場所で 2 つ走らせると衝突する
                </span>
              </div>
            </label>
          </div>

          {useWorktree && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={LABEL}>ブランチ名</span>
              <input value={branch} spellCheck={false} placeholder="feat/palette"
                onChange={(e) => setBranch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && ready) void start() }}
                style={{ ...INPUT, borderColor: problem ? C.red : C.line2 }} />
              {problem && <span style={{ fontSize: 11.5, color: C.red }}>{problem}</span>}
              {!problem && targetPath && (
                <span style={{ font: `11px ${MONO}`, color: C.faint }}>
                  {targetPath}
                  {slugifyBranch(branch) !== branch.trim() && ' ← ディレクトリ名は変換されます'}
                </span>
              )}
            </div>
          )}

          {failure && (
            <div style={{ border: `1px solid ${C.red}`, borderRadius: 7, padding: '9px 12px',
              fontSize: 11.5, color: C.red, whiteSpace: 'pre-wrap' }}>{failure}</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end',
          padding: '13px 18px', borderTop: `1px solid ${C.line}` }}>
          <button onClick={onCancel} style={GHOST}>やめる</button>
          <button onClick={() => void start()} disabled={!ready}
            style={{ ...BTN, opacity: ready ? 1 : 0.45 }}>
            {busy ? '用意しています…' : '起こす'}
          </button>
        </div>
      </div>
    </div>
  )
}

const LABEL: React.CSSProperties = { fontSize: 11, letterSpacing: '0.08em', color: C.dim2, fontWeight: 600 }
const INPUT: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 7, border: `1px solid ${C.line2}`,
  background: C.bg, color: C.ink, font: `12px ${MONO}`, outline: 'none'
}
const ROW: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }
const BTN: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 7, border: 'none', background: C.amber,
  color: C.amberInk, fontWeight: 600, fontSize: 12.5, cursor: 'pointer'
}
const GHOST: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 7, border: `1px solid ${C.line2}`,
  background: 'transparent', color: C.ink2, fontSize: 12.5, cursor: 'pointer'
}
