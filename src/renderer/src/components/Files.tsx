import { useState } from 'react'
import type { Panel } from '../useSessions'
import { touchedFiles, type Touched } from '../../../shared/touched'
import { displayPath, mentionFile } from '../../../shared/mention'
import { C, ellipsis, F, MONO, R, S } from '../theme'
import { Button, Faint, Tag } from './ui'

/**
 * このセッションで**自分のリポジトリの何が変わったか**（§35 の「変更」）。
 *
 * **保存層は無い。** 会話そのものから導く（`shared/touched.ts`）ので、
 * 会話と食い違うことがない。
 *
 * 書いたものを上に置く。人がここを開くのは
 * 「差分を見る前に何が変わったかを知るため」だからである。
 */
export function Files({
  panel,
  onOpen,
  onAsk
}: {
  panel: Panel
  /** 中で読む（§34）。省略なら押せない */
  onOpen?: (path: string) => void
  /** 入力欄に足す文。省略なら釦を出さない */
  onAsk?: (mention: string) => void
}): React.JSX.Element {
  const files = touchedFiles(panel.transcript, panel.transcript.tasks)
  /**
   * **worktree の中だけを出す**（§35。利用者の判断）。エージェントは作業ディレクトリの外も触る
   * （scratchpad、`~/.claude/`、一時ディレクトリ）が、それは「自分のリポジトリの何が変わったか」の
   * 答えではない。外のものは**数だけ出して畳む** —— 黙って消すと、触ったことに気づけない
   */
  const base = panel.cwd.endsWith('/') ? panel.cwd : `${panel.cwd}/`
  const inside = files.filter((f) => f.path.startsWith(base))
  const outside = files.filter((f) => !f.path.startsWith(base))
  const wrote = inside.filter((f) => f.wrote > 0)
  const read = inside.filter((f) => f.wrote === 0)
  const [showOutside, setShowOutside] = useState(false)

  if (files.length === 0) {
    return (
      <div style={{ padding: S.lg }}>
        <Faint>まだファイルを読み書きしていません</Faint>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg, padding: S.lg }}>
      {wrote.length > 0 && (
        <Group
          label={`書き換えた ${wrote.length} 件`}
          files={wrote}
          cwd={panel.cwd}
          onOpen={onOpen}
          onAsk={onAsk}
        />
      )}
      {read.length > 0 && (
        <Group
          label={`読んだだけ ${read.length} 件`}
          files={read}
          cwd={panel.cwd}
          onOpen={onOpen}
          onAsk={onAsk}
        />
      )}

      {inside.length === 0 && <Faint>このリポジトリの中は、まだ読み書きしていません</Faint>}

      {/* 外は数だけ。**捨てはしない** —— 開けば見える（§35） */}
      {outside.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
          <span
            onClick={() => setShowOutside((v) => !v)}
            style={{ fontSize: F.small, color: C.dim2, cursor: 'pointer' }}
          >
            {showOutside ? '▾' : '▸'} このリポジトリの外 {outside.length} 件
          </span>
          {showOutside && (
            <Group label="" files={outside} cwd={panel.cwd} onOpen={onOpen} onAsk={onAsk} />
          )}
        </div>
      )}
    </div>
  )
}

function Group({
  label,
  files,
  cwd,
  onOpen,
  onAsk
}: {
  label: string
  files: Touched[]
  cwd: string
  onOpen?: (path: string) => void
  onAsk?: (mention: string) => void
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
      {label !== '' && <span style={{ fontSize: F.small, color: C.dim2 }}>{label}</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: S.xs }}>
        {files.map((f) => (
          <div
            key={f.path}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: S.md,
              padding: `${S.sm}px ${S.md}px`,
              border: `1px solid ${C.line}`,
              borderRadius: R.md
            }}
          >
            <span
              title={f.path}
              onClick={onOpen ? () => onOpen(f.path) : undefined}
              style={{
                font: `${F.small}px ${MONO}`,
                color: C.ink2,
                flexGrow: 1,
                cursor: onOpen ? 'pointer' : undefined,
                ...ellipsis
              }}
            >
              {displayPath(cwd, f.path)}
            </span>
            {f.by.map((who) => (
              <Tag key={who}>{who}</Tag>
            ))}
            <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, flexShrink: 0 }}>
              {f.wrote > 0 ? `${f.wrote} 回` : `${f.read} 回`}
            </span>
            {/* 指して頼む（§34）。直すのはエージェント、承認は人 */}
            {onAsk && (
              <Button size="sm" onClick={() => onAsk(mentionFile(cwd, f.path))}>
                話す
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
