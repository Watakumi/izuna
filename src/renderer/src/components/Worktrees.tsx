import { useCallback, useEffect, useState } from 'react'
import type { WorktreeStatus } from '../../../main/git/worktree'
import { canRemove, type Worktree } from '../../../shared/worktree'
import type { Panel } from '../useSessions'
import { F, C, MONO, ellipsis, S } from '../theme'
import { makeCache } from '../remember'
import { Button, Loading, Reload, Result, Tag } from './ui'

/**
 * worktree の一覧（段3 の見える化）。
 *
 * **いまあるものを見せて、消せるようにするだけ。** 作らない（§12 実測 ——
 * worktree を作るのはエージェントで、`EnterWorktree` が
 * `<project>/.claude/worktrees/` に作る）。ブレイン配下の実行役は Claude Code の
 * agent isolation が配るので、ここには出ない（CLAUDE.md §12）。
 *
 * 削除は取り返しがつかないので、**未 push を警告してから**にする。
 */
type Row = Worktree & { status: WorktreeStatus | null; session: Panel | null }

/**
 * 覚えておく中身。鍵は作業ディレクトリ。
 *
 * **セッションは覚えない**（`panels` は毎回渡ってくる生の状態で、
 * 古いものを混ぜると「終わったセッションが走っている」と嘘になる）。
 */
const remembered = makeCache<Omit<Row, 'session'>[]>()

/** 結果の札。時刻は押した瞬間（描画の中で時計を読まない。react-hooks/purity） */
const outcome = (text: string, bad: boolean): { text: string; bad: boolean; at: number } => ({
  text,
  bad,
  at: Date.now()
})

export function Worktrees({
  cwd,
  panels,
  onOpen
}: {
  cwd: string
  panels: Panel[]
  onOpen: (worktree: Worktree) => void
}): React.JSX.Element {
  // 一度読んだものは覚えておく（`remember.ts` の註）。セッションだけは今のものを当てる
  const seed = remembered.get(cwd)
  const [rows, setRows] = useState<Row[] | null>(
    seed ? seed.map((w) => ({ ...w, session: panels.find((p) => p.cwd === w.path) ?? null })) : null
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad: boolean; at: number } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    const repo = await window.izuna.repo(cwd)
    const withStatus = await Promise.all(
      repo.worktrees.map(async (w) => ({
        ...w,
        status: await window.izuna.worktreeStatus(w.path).catch(() => null),
        session: panels.find((p) => p.cwd === w.path) ?? null
      }))
    )
    setRows(withStatus)
    remembered.set(
      cwd,
      withStatus.map(({ session: _session, ...rest }) => rest)
    )
  }, [cwd, panels])

  useEffect(() => {
    // 取ってきてから setState する（await の後）。同期の setState ではない
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const remove = async (row: Row, force: boolean): Promise<void> => {
    setBusy(row.path)
    setMsg(null)
    try {
      await window.izuna.removeWorktree(cwd, row.path, force)
      setMsg(outcome(`${row.branch ?? row.path} を消しました`, false))
      setConfirming(null)
      await load()
    } catch (e) {
      setMsg(outcome(String(e).replace(/^Error:\s*/, ''), true))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          background: C.panel,
          borderBottom: `1px solid ${C.line}`,
          flexShrink: 0
        }}
      >
        <span style={{ fontWeight: 600, fontSize: F.body }}>ブランチ</span>

        <div style={{ flexGrow: 1 }} />
        <Reload onClick={() => void load()} />
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!rows && <Loading />}

        {rows?.map((row) => {
          const blocked = canRemove(row)
          const unpushed = (row.status?.ahead ?? 0) > 0 || (row.status?.changed ?? 0) > 0
          return (
            <div
              key={row.path}
              style={{
                border: `1px solid ${row.session ? C.line2 : C.line}`,
                borderRadius: 7,
                padding: '12px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                background: row.session ? C.raised : 'transparent'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: row.session?.pending
                      ? C.amber
                      : row.session
                        ? C.teal
                        : 'transparent',
                    border: row.session ? 'none' : `1.5px solid ${C.faint}`
                  }}
                />
                <span style={{ font: `${F.small}px ${MONO}`, color: C.ink, ...ellipsis }}>
                  {row.branch ?? '(detached)'}
                </span>
                {row.main && <Tag>本体</Tag>}
                {row.locked !== null && <Tag>ロック</Tag>}
              </div>

              {row.status && (
                <div style={{ display: 'flex', gap: 12, fontSize: F.small }}>
                  <span style={{ color: C.teal }}>+{row.status.added}</span>
                  <span style={{ color: C.red }}>−{row.status.removed}</span>
                  <span style={{ color: C.dim2 }}>{row.status.changed} ファイル</span>
                  {row.status.ahead > 0 && (
                    <span style={{ color: C.amber }}>↑{row.status.ahead}</span>
                  )}
                </div>
              )}

              {confirming === row.path ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    background: C.amberBg,
                    border: `1px solid ${C.amberLine}`,
                    borderRadius: 7,
                    padding: '8px 12px'
                  }}
                >
                  <span style={{ fontSize: F.small, color: C.ink2, lineHeight: 1.6 }}>
                    {unpushed
                      ? '未 push の変更があります。消すと戻せません'
                      : 'ディレクトリを消します'}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      reserve={['消す', '消しています…']}
                      disabled={busy !== null}
                      kind="primary"
                      onClick={() => void remove(row, unpushed)}
                    >
                      {busy === row.path ? '消しています…' : '消す'}
                    </Button>
                    <Button onClick={() => setConfirming(null)}>やめる</Button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  {!row.session && !row.main && (
                    <Button kind="primary" onClick={() => onOpen(row)}>
                      ここで開く
                    </Button>
                  )}
                  {!blocked && <Button onClick={() => setConfirming(row.path)}>消す</Button>}
                  {blocked && (
                    <span style={{ fontSize: F.micro, color: C.faint, alignSelf: 'center' }}>
                      {blocked}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {msg && (
        <div style={{ padding: S.lg, borderTop: `1px solid ${C.line}` }}>
          <Result {...msg} />
        </div>
      )}
    </div>
  )
}
