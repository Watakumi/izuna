import { useEffect, useState } from 'react'
import type { FileDiff } from '../../../shared/diff'
import { C, F, MONO, S } from '../theme'
import { DiffView } from './DiffView'
import { Faint } from './ui'

/**
 * sandbox（Forgejo）の PR の差分（docs/NIMBALYST.md §7 の 3）。
 *
 * 柱 2 の「実行役の成果を sandbox でまとめて見る」の、見る側。
 * 承認で使っている `DiffView` をそのまま使う。**Izuna は読むだけ**で、
 * accept / reject はしない（判断は PR のマージで人がする）。
 */
export function PullDiff({ load }: { load: () => Promise<FileDiff[]> }): React.JSX.Element {
  const [files, setFiles] = useState<FileDiff[] | null | undefined>(undefined)
  const [failure, setFailure] = useState<string | null>(null)

  // PR ごとに 1 つ mount されるので、読み直しは要らない（状態の初期値が「読んでいる」）
  useEffect(() => {
    let live = true
    load()
      .then((f) => { if (live) setFiles(f) })
      .catch((e: unknown) => { if (live) { setFiles(null); setFailure(String(e).replace(/^Error:\s*/, '')) } })
    return () => { live = false }
  }, [load])

  if (files === undefined) return <Faint>差分を読んでいます…</Faint>
  if (files === null) return <span style={{ fontSize: F.small, color: C.red }}>{failure ?? '読めませんでした'}</span>
  if (files.length === 0) return <Faint>差分がありません</Faint>

  const added = files.reduce((n, f) => n + f.added, 0)
  const removed = files.reduce((n, f) => n + f.removed, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.md }}>
      <span style={{ font: `${F.small}px ${MONO}`, color: C.dim2 }}>
        {files.length} ファイル · <span style={{ color: C.teal }}>+{added}</span> <span style={{ color: C.red }}>−{removed}</span>
      </span>
      {files.map((f) => <DiffView key={f.path} diff={f} max={200} />)}
    </div>
  )
}
