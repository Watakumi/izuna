import { useEffect, useState } from 'react'
import {
  CUSTOM_LABEL,
  DEFAULT_CUSTOM,
  type CustomColors,
  type ThemeChoice
} from '../../../shared/ghostty'
import { applySkin, C, F, MONO, R, S } from '../theme'
import { Button, Card, ColorInput, Faint, Loading, Result, Section, Select } from './ui'

/** その場に出す結果（`Result` に渡す形） */
interface Said {
  text: string
  bad: boolean
  at: number
}

/**
 * 設定（§37）。いまは配色だけを持つ。
 *
 * **準備（`ForgeSetup`）とは別にする。** あちらは「使い始めるために要るもの」
 * （Claude Code、Forgejo、トークン）で、無いと動かない。こちらは
 * 「動くけれど好みで変えるもの」である。同じ覆いに積むと、
 * 初めて開いた人が**どれをやらないと始まらないのか**を読めなくなる。
 *
 * 押した結果はその場に出す（§35）—— 選んだ瞬間に画面の色が変わるので、
 * 効いたことは見れば分かる。文でも言うのは、**何が選ばれているか**が
 * 色だけでは読めないからである。
 */
export function Settings({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [current, setCurrent] = useState<ThemeChoice | null>(null)
  const [available, setAvailable] = useState<string[] | null>(null)
  const [custom, setCustom] = useState<CustomColors>(DEFAULT_CUSTOM)
  const [said, setSaid] = useState<Said | null>(null)

  useEffect(() => {
    void window.izuna
      .themes()
      .then(({ current: c, available: a }) => {
        setCurrent(c)
        setAvailable(a)
        if (c.kind === 'custom') setCustom(c.colors)
      })
      .catch((e: Error) => {
        // 読めなくても画面は出す。**黙って既定に倒さず、読めなかったと言う**
        setCurrent({ kind: 'ghostty' })
        setAvailable([])
        setSaid({ text: `設定を読めませんでした: ${e.message}`, bad: true, at: Date.now() })
      })
  }, [])

  const choose = (choice: ThemeChoice, what: string): void => {
    setCurrent(choice)
    void window.izuna
      .setTheme(choice)
      .then((skin) => {
        // 組み直した配色をその場で当てる。**取り直しも再起動も要らない**
        applySkin(skin)
        setSaid({ text: `${what}にしました`, bad: false, at: Date.now() })
      })
      .catch((e: Error) => setSaid({ text: e.message, bad: true, at: Date.now() }))
  }

  const kind = current?.kind ?? null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8,9,12,0.62)',
        zIndex: 40,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 64
      }}
    >
      {/*
        **スクロールする箱と、並べる箱を分ける**（§32 の罠）。同じ div に
        `overflowY` と `flexDirection: column` を付けると、高さが足りないとき
        子が縮んで中身が窓の外に出る
      */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxHeight: '84vh',
          overflowY: 'auto',
          background: C.surface,
          border: `1px solid ${C.line2}`,
          borderRadius: 11,
          boxShadow: '0 28px 80px rgba(0,0,0,0.62)'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg, padding: S.xl }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md }}>
            <span style={{ fontSize: F.title, color: C.ink }}>設定</span>
            <span style={{ flexGrow: 1 }} />
            <Button size="sm" onClick={onClose}>
              閉じる
            </Button>
          </div>

          <Section label="配色">
            {current === null ? (
              <Loading />
            ) : (
              <>
                <Pick
                  on={kind === 'ghostty'}
                  title="Ghostty に合わせる"
                  note="利用者の Ghostty の設定とテーマを読みます"
                  onClick={() => choose({ kind: 'ghostty' }, 'Ghostty に合わせる')}
                />
                <Pick
                  on={kind === 'builtin'}
                  title="Izuna の既定"
                  note="Ghostty を使っていないときはこちら"
                  onClick={() => choose({ kind: 'builtin' }, 'Izuna の既定')}
                />
                <Pick
                  on={kind === 'custom'}
                  title="自分で決める"
                  note="5 つの色から段を作ります（読む字のコントラストは Izuna が保ちます）"
                  onClick={() => choose({ kind: 'custom', colors: custom }, '自分で決めた配色')}
                />
              </>
            )}

            {kind === 'custom' && (
              <Card>
                <div style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
                  {(Object.keys(DEFAULT_CUSTOM) as Array<keyof CustomColors>).map((key) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: S.md }}>
                      <span style={{ fontSize: F.small, color: C.dim, width: 96, flexShrink: 0 }}>
                        {CUSTOM_LABEL[key]}
                      </span>
                      <ColorInput
                        value={custom[key]}
                        onChange={(hex) => {
                          const next = { ...custom, [key]: hex }
                          setCustom(next)
                          choose({ kind: 'custom', colors: next }, '自分で決めた配色')
                        }}
                      />
                      <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint }}>
                        {custom[key]}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* 実機にあるテーマ。**無ければ節ごと出さない**（§35） */}
            {available !== null && available.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: S.xs }}>
                <Faint>Ghostty のテーマから選ぶ（{available.length} 件）</Faint>
                <Select
                  label="Ghostty のテーマ"
                  placeholder="選んでください"
                  value={current?.kind === 'named' ? current.name : ''}
                  options={available}
                  onChange={(v) => v !== '' && choose({ kind: 'named', name: v }, v)}
                />
              </div>
            )}

            {said && <Result {...said} />}
          </Section>

          <Faint>
            書体と行送りは、どの選び方でも利用者の Ghostty から借ります（配色だけを差し替えます）。
            開いているターミナルの中は、開き直すまで前の配色のままです。
          </Faint>
        </div>
      </div>
    </div>
  )
}

function Pick({
  on,
  title,
  note,
  onClick
}: {
  on: boolean
  title: string
  note: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: S.md,
        padding: `${S.sm}px ${S.md}px`,
        border: `1px solid ${on ? C.amberLine : C.line}`,
        background: on ? C.amberBg : 'transparent',
        borderRadius: R.md,
        cursor: 'pointer'
      }}
    >
      <span style={{ fontSize: F.body, color: C.ink, flexShrink: 0 }}>{title}</span>
      <span style={{ fontSize: F.micro, color: C.faint, flexGrow: 1 }}>{note}</span>
      {on && <span style={{ fontSize: F.small, color: C.amber, flexShrink: 0 }}>選択中</span>}
    </div>
  )
}
