import { useState } from 'react'
import type { Panel } from '../useSessions'
import { C, F, MONO, R, S } from '../theme'
import { Button, Faint, Meter, NumberInput } from './ui'

/**
 * 自律ループ（§23）。
 *
 * **承認は迂回しない。** 権限モードは人が選んだままで、ループ中も承認は
 * 上がってくる。無人で回したいなら、人がモードを選ぶ ——
 * `docs/GOAL.md` の完成の定義 5（承認は人間が持つ）を崩さないための線引きである。
 *
 * **止める手段を必ず出す。** 無人で回るものに、止め方が無いのは怖い。
 */
export function Loop({ panel }: { panel: Panel }): React.JSX.Element {
  const [max, setMax] = useState(10)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const loop = panel.loop
  const running = loop !== null && loop.stop === null

  const act = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      await work()
    } catch (e) {
      setFailure(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg, padding: S.lg }}>
      {!running && (
        <>
          <Faint>
            共有フォルダの brief.md と tasks/ を読んで、終わったと宣言するまで繰り返します。
            文脈は毎回捨てるので、引き継ぐのは進捗に書いたものだけです
          </Faint>
          <label style={{ display: 'flex', alignItems: 'center', gap: S.md, fontSize: F.body }}>
            上限
            <NumberInput value={max} min={1} max={100} onChange={setMax} disabled={busy} />
            回
          </label>
          <Button kind="primary" disabled={busy || panel.ended}
            onClick={() => void act(() => window.izuna.startLoop({ id: panel.id, maxIterations: max }))}>
            {busy ? '始めています…' : '回す'}
          </Button>
        </>
      )}

      {loop && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: S.md }}>
          <Meter label={`反復 ${loop.iteration} / ${max}`} value={Math.min(loop.iteration / max, 1)} />
          <span style={{ font: `${F.small}px ${MONO}`, color: C.dim2 }}>
            {loop.progress.phase === 'planning' ? '計画' : '実装'}
          </span>
          {loop.progress.learnings.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
              <span style={{ fontSize: F.small, color: C.dim2, letterSpacing: '0.08em', fontWeight: 600 }}>
                分かったこと
              </span>
              {loop.progress.learnings.slice(-4).map((l) => (
                <span key={l.iteration} style={{ fontSize: F.small, color: C.dim, lineHeight: 1.6 }}>
                  {l.iteration}. {l.summary}
                </span>
              ))}
            </div>
          )}
          {loop.progress.blockers.length > 0 && (
            <div style={{
              border: `1px solid ${C.amberLine}`, background: C.amberBg,
              borderRadius: R.md, padding: S.lg, display: 'flex', flexDirection: 'column', gap: S.xs
            }}>
              <span style={{ fontSize: F.small, color: C.amber }}>進めない理由</span>
              {loop.progress.blockers.map((b, i) => (
                <span key={i} style={{ fontSize: F.body, color: C.ink2 }}>{b}</span>
              ))}
            </div>
          )}
          {loop.stop && (
            <span style={{ fontSize: F.body, color: C.dim }}>止まりました: {loop.stop.detail}</span>
          )}
        </div>
      )}

      {running && (
        <Button kind="danger" disabled={busy}
          onClick={() => void act(() => window.izuna.stopLoop(panel.id))}>
          止める
        </Button>
      )}

      {failure && <span style={{ fontSize: F.small, color: C.red }}>{failure}</span>}
    </div>
  )
}
