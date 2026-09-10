import type { Panel } from '../useSessions'
import { touchedFiles, type Touched } from '../../../shared/touched'
import { C, ellipsis, F, MONO, R, S } from '../theme'
import { Faint, Tag } from './ui'

/**
 * このセッションでエージェントが触ったファイル。
 *
 * **保存層は無い。** 会話そのものから導く（`shared/touched.ts`）ので、
 * 会話と食い違うことがない。
 *
 * 書いたものを上に置く。人がここを開くのは
 * 「差分を見る前に何が変わったかを知るため」だからである。
 */
export function Files({ panel }: { panel: Panel }): React.JSX.Element {
  const files = touchedFiles(panel.transcript, panel.transcript.tasks)
  const wrote = files.filter((f) => f.wrote > 0)
  const read = files.filter((f) => f.wrote === 0)

  if (files.length === 0) {
    return (
      <div style={{ padding: S.lg }}>
        <Faint>まだファイルを触っていません</Faint>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg, padding: S.lg }}>
      {wrote.length > 0 && (
        <Group label={`書き換えた ${wrote.length} 件`} files={wrote} cwd={panel.cwd} />
      )}
      {read.length > 0 && (
        <Group label={`読んだだけ ${read.length} 件`} files={read} cwd={panel.cwd} />
      )}
    </div>
  )
}

function Group({
  label,
  files,
  cwd
}: {
  label: string
  files: Touched[]
  cwd: string
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
      <span style={{ fontSize: F.small, color: C.dim2 }}>{label}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: S.xs }}>
        {files.map((f) => (
          <div
            key={f.path}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: S.md,
              padding: `${S.sm}px ${S.md}px`,
              border: `1px solid ${C.line}`,
              borderRadius: R.md
            }}
          >
            <span
              title={f.path}
              style={{
                font: `${F.small}px ${MONO}`,
                color: C.ink2,
                flexGrow: 1,
                direction: 'rtl',
                textAlign: 'left',
                ...ellipsis
              }}
            >
              {relative(f.path, cwd)}
            </span>
            {f.by.map((who) => (
              <Tag key={who}>{who}</Tag>
            ))}
            <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, flexShrink: 0 }}>
              {f.wrote > 0 ? `${f.wrote} 回` : `${f.read} 回`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 作業ディレクトリからの相対で出す。**外のファイルは絶対のまま** ——
 * `../../` を並べると、どこを触ったのか読み取れなくなる。
 */
function relative(path: string, cwd: string): string {
  const base = cwd.endsWith('/') ? cwd : cwd + '/'
  return path.startsWith(base) ? path.slice(base.length) : path
}
