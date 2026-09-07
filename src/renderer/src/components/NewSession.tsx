import { useEffect, useState } from 'react'
import type { RepoInfo } from '../../../shared/ipc'
import type { FoundRepo } from '../../../main/repos'
import type { GitHubIssue } from '../../../main/forge/github'
import { belongsTo, byNewest, labelOf, type SessionSummary } from '../../../shared/sessions'
import { C, F, MONO, R, S, ellipsis } from '../theme'
import { Button, Faint, Input, TextArea } from './ui'

/**
 * セッションを起こす（段3・段4 の入口）。
 *
 * **worktree はここに出てこない。** 隔離するのはエージェントの仕事で、
 * `EnterWorktree` を呼んで `<project>/.claude/worktrees/` に作る（§12 実測）。
 * 以前はここに「worktree を作る」チェックとブランチ名の欄があったが、
 * **Izuna が別の場所（`~/.izuna/worktrees/`）に作る二重の経路**になっていた。
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
  /** 続きから起こすときの claude 側のセッション id */
  resume?: string
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

  const [showAllPast, setShowAllPast] = useState(false)

  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const [past, setPast] = useState<SessionSummary[] | null>(null)

  useEffect(() => { void window.izuna.findRepos().then(setFound).catch(() => setFound([])) }, [])

  // 過去のセッション（§18）。**保存層は無い** —— claude が書いた記録を走査している
  useEffect(() => { void window.izuna.listSessions().then(setPast).catch(() => setPast([])) }, [])

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
        })
      window.izuna.ghIssues(path).then((v) => { if (alive) setIssues(v) }).catch(() => { if (alive) setIssues(null) })
    }, 300)
    return () => { alive = false; clearTimeout(timer) }
  }, [cwd])

  const matches = (found ?? []).filter((r) => {
    const q = query.trim().toLowerCase()
    return q === '' || r.name.toLowerCase().includes(q) || r.group.toLowerCase().includes(q)
  })


  const prompt = issue
    ? `GitHub の Issue #${issue.number}「${issue.title}」に取り組んでください。\n${issue.url}`
    : text.trim()

  // この画面で選んだリポジトリのもの。**worktree のセッションも同じ束**にする
  const resumable = (past ?? [])
    .filter((p) => cwd.trim() !== '' && belongsTo(p, cwd.trim(), (repo?.worktrees ?? []).map((w) => w.path)))
    .sort(byNewest)

  /**
   * **やることは必須にしない。** 「とりあえず開いて、会話で伝える」を潰さない。
   * 空なら何も送らず、会話の入力欄から始める。
   */
  const ready = !busy && cwd.trim() !== ''

  /**
   * 続きからのときは、記録に残っていた `cwd` でそのまま起こす
   * （その worktree にいたなら、そこに戻る）。
   */
  const start = async (resume?: SessionSummary): Promise<void> => {
    if (resume) {
      setBusy(true)
      setFailure(null)
      try {
        const at = resume.cwd ?? cwd.trim()
        await onStart({
          cwd: at, label: labelOf(resume).slice(0, 40), branch: resume.branch ?? null,
          team: at.split('/').filter(Boolean).pop() ?? 'default',
          initialPrompt: '', resume: resume.id
        })
      } catch (e) {
        setFailure(String(e).replace(/^Error:\s*/, ''))
        setBusy(false)
      }
      return
    }
    if (!ready) return
    setBusy(true)
    setFailure(null)
    try {
      const base = repo?.root ?? cwd.trim()
      const name = repo?.name ?? base.split('/').filter(Boolean).pop() ?? base
      // prompt は空でよい。空なら何も送らず、会話の入力欄から始める
      await onStart({ cwd: base, label: name, branch: null, team: name, initialPrompt: prompt })
    } catch (e) {
      setFailure(String(e).replace(/^Error:\s*/, ''))
      setBusy(false)
    }
  }

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.62)',
      zIndex: 40, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 64 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 660, maxHeight: '84vh',
        background: C.surface, border: `1px solid ${C.line2}`, borderRadius: 11,
        boxShadow: '0 28px 80px rgba(0,0,0,0.62)', display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '16px 16px', borderBottom: `1px solid ${C.line}`, fontWeight: 600 }}>
          新しいセッション
        </div>

        <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: 16,
          display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 1. どこで */}
          <Section label="どのリポジトリ" action={
            <Button size="sm" onClick={() => void window.izuna.pickDirectory()
              .then((p) => { if (p) { setCwd(p); setQuery(''); setIssue(null) } })}>
              フォルダを選ぶ…
            </Button>
          }>
            {found === null && <Faint>探しています…</Faint>}
            {found !== null && (
              <>
                <Input value={query} placeholder={`${found.length} 本から絞り込む`}
                  onChange={(e) => setQuery(e.target.value)} />
                <div style={{ maxHeight: 132, overflowY: 'auto', border: `1px solid ${C.line}`,
                  borderRadius: 7, display: 'flex', flexDirection: 'column' }}>
                  {matches.slice(0, 60).map((r) => (
                    <div key={r.path} onClick={() => { setCwd(r.path); setIssue(null) }}
                      style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '8px 12px',
                        cursor: 'pointer', borderLeft: `2px solid ${r.path === cwd ? C.amber : 'transparent'}`,
                        background: r.path === cwd ? C.raised : 'transparent' }}>
                      <span style={{ fontSize: 12, color: r.path === cwd ? C.ink : C.ink2 }}>{r.name}</span>
                      <span style={{ font: `10px ${MONO}`, color: C.faint, flexGrow: 1,
                        textAlign: 'right', ...ellipsis }}>{r.group}</span>
                    </div>
                  ))}
                  {matches.length === 0 && <Faint style={{ padding: '12px 12px' }}>当たるものがありません</Faint>}
                </div>
              </>
            )}
            {repoError && <span style={{ fontSize: 11, color: C.amber, lineHeight: 1.6 }}>{repoError}</span>}
          </Section>

          {/* 2. 続きから —— 新しく始めるか、続きか。**同じ画面で選ぶ** */}
          {resumable.length > 0 && (
            <Section label="続きから" action={
              resumable.length > 4
                ? <Button size="sm" onClick={() => setShowAllPast((v) => !v)}>
                    {showAllPast ? '畳む' : `ほか ${resumable.length - 4} 件`}
                  </Button>
                : undefined
            }>
              <div style={{ display: 'flex', flexDirection: 'column', gap: S.xs }}>
                {(showAllPast ? resumable : resumable.slice(0, 4)).map((p) => (
                  <div key={p.id} onClick={() => void start(p)}
                    style={{ display: 'flex', alignItems: 'baseline', gap: S.md, padding: '8px 12px',
                      borderRadius: R.md, cursor: busy ? 'default' : 'pointer',
                      border: `1px solid ${C.line}`, opacity: busy ? 0.5 : 1 }}>
                    <span style={{ fontSize: F.body, color: C.ink2, flexGrow: 1, ...ellipsis }}>
                      {labelOf(p)}
                    </span>
                    <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, flexShrink: 0 }}>
                      {ago(p.updatedAt)}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 3. 何をするか —— ここが本題 */}
          {cwd.trim() !== '' && (
            <Section label="何をするか（任意）">
              {issues && issues.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {issues.slice(0, 5).map((i) => (
                    <div key={i.number} onClick={() => { setIssue(i); setText('') }}
                      style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '8px 12px',
                        borderRadius: 7, cursor: 'pointer',
                        border: `1px solid ${issue?.number === i.number ? C.amberLine : C.line}`,
                        background: issue?.number === i.number ? C.amberBg : 'transparent' }}>
                      <span style={{ font: `11px ${MONO}`, color: C.dim2, flexShrink: 0 }}>#{i.number}</span>
                      <span style={{ fontSize: 12, color: C.ink2, ...ellipsis }}>{i.title}</span>
                    </div>
                  ))}
                </div>
              )}
              {issues !== null && issues.length === 0 && <Faint>open な Issue はありません</Faint>}
              {issues === null && cwd.trim() !== '' && <Faint>GitHub に繋がっていません。下に直接書けます</Faint>}

              <TextArea
                value={text} rows={2}
                placeholder={issues && issues.length > 0
                  ? 'または、やることを直接書く（後で会話でもいい）'
                  : 'やることを書く（後で会話でもいい）'}
                onChange={(e) => { setText(e.target.value); setIssue(null) }}
              />
            </Section>
          )}


          {failure && (
            <div style={{ border: `1px solid ${C.red}`, borderRadius: 7, padding: '8px 12px',
              fontSize: 11, color: C.red, whiteSpace: 'pre-wrap' }}>{failure}</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
          borderTop: `1px solid ${C.line}` }}>
          <span style={{ fontSize: F.small, color: C.faint }}>
            {!ready ? '' : prompt !== ''
              ? '起こすと、選んだ内容がそのまま最初の依頼になります'
              : 'そのまま開きます。やることは会話で伝えられます'}
          </span>
          <div style={{ flexGrow: 1 }} />
          <Button onClick={onCancel} >やめる</Button>
          <Button kind="primary" onClick={() => void start()} disabled={!ready}>
            {busy ? '用意しています…' : '起こす'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 経過時間。**日時をそのまま出さない** —— 一覧で見たいのは「どれが新しいか」 */
function ago(at: number): string {
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000))
  if (m < 60) return `${m}分前`
  if (m < 60 * 24) return `${Math.round(m / 60)}時間前`
  return `${Math.round(m / 60 / 24)}日前`
}

function Section({ label, action, children }: {
  label: string; action?: React.ReactNode; children: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.08em', color: C.dim2, fontWeight: 600 }}>{label}</span>
        <div style={{ flexGrow: 1 }} />
        {action}
      </div>
      {children}
    </div>
  )
}

