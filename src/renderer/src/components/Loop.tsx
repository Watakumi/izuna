import { useCallback, useEffect, useState } from 'react'
import type { Panel } from '../useSessions'
import { until, WAKEUP_STATE_LABEL, type Wakeup } from '../../../shared/wakeup'
import { C, ellipsis, F, MONO, R, S } from '../theme'
import { Button, Faint, Input, Loading, Meter, NumberInput, Reload } from './ui'

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
            <NumberInput value={max} min={1} max={100} onChange={setMax} disabled={busy} />回
          </label>
          <Button
            reserve={['始める', '始めています…']}
            kind="primary"
            disabled={busy || panel.ended}
            onClick={() =>
              void act(() => window.izuna.startLoop({ id: panel.id, maxIterations: max }))
            }
          >
            {busy ? '始めています…' : '始める'}
          </Button>
        </>
      )}

      {loop && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: S.md }}>
          <Meter
            label={`反復 ${loop.iteration} / ${max}`}
            value={Math.min(loop.iteration / max, 1)}
          />
          <span style={{ font: `${F.small}px ${MONO}`, color: C.dim2 }}>
            {loop.progress.phase === 'planning' ? '計画' : '実装'}
          </span>
          {loop.progress.learnings.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
              <span
                style={{
                  fontSize: F.small,
                  color: C.dim2,
                  letterSpacing: '0.08em',
                  fontWeight: 600
                }}
              >
                分かったこと
              </span>
              {loop.progress.learnings.slice(-4).map((l) => (
                <span
                  key={l.iteration}
                  style={{ fontSize: F.small, color: C.dim, lineHeight: 1.6 }}
                >
                  {l.iteration}. {l.summary}
                </span>
              ))}
            </div>
          )}
          {loop.progress.blockers.length > 0 && (
            <div
              style={{
                border: `1px solid ${C.amberLine}`,
                background: C.amberBg,
                borderRadius: R.md,
                padding: S.lg,
                display: 'flex',
                flexDirection: 'column',
                gap: S.xs
              }}
            >
              <span style={{ fontSize: F.small, color: C.amber }}>進めない理由</span>
              {loop.progress.blockers.map((b, i) => (
                <span key={i} style={{ fontSize: F.body, color: C.ink2 }}>
                  {b}
                </span>
              ))}
            </div>
          )}
          {loop.stop && (
            <span style={{ fontSize: F.body, color: C.dim }}>止まりました: {loop.stop.detail}</span>
          )}
        </div>
      )}

      {running && (
        <Button
          kind="danger"
          disabled={busy}
          onClick={() => void act(() => window.izuna.stopLoop(panel.id))}
        >
          止める
        </Button>
      )}

      {failure && <span style={{ fontSize: F.small, color: C.red }}>{failure}</span>}

      <Wakeups panel={panel} />
    </div>
  )
}

/**
 * 時刻を決めて送る予約（§23、docs/NIMBALYST.md §7 の 2）。
 *
 * 口は前からあったが、画面から呼ばれていなかった。予約する・消す・過ぎたものを
 * いま送る、の 3 つ。**過ぎたものは勝手に走らない**（`shared/wakeup.ts`）ので、
 * ここで人が送る。覚えの無いものは送らないと書いて見せる。
 */
function Wakeups({ panel }: { panel: Panel }): React.JSX.Element {
  // null は「まだ読んでいない」。読むまで何も断定しない
  const [list, setList] = useState<Wakeup[] | null>(null)
  const [minutes, setMinutes] = useState(30)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // 待ち時間の基準。描くたびに取ると純粋でなくなるので、読んだときの時刻を持つ
  const [now, setNow] = useState(0)

  const load = useCallback((): void => {
    void window.izuna
      .listWakeups()
      .then((all) => {
        setNow(Date.now())
        setList(all.filter((w) => w.sessionId === panel.id))
      })
      .catch(() => setList([]))
  }, [panel.id])
  // 起きたら一覧も変わる。会話に知らせが足されたときに読み直す
  useEffect(load, [load, panel.transcript.items.length])

  const act = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      await work()
      load()
    } catch (e) {
      setFailure(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: S.md,
        borderTop: `1px solid ${C.line}`,
        paddingTop: S.lg
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{ fontSize: F.small, color: C.dim2, letterSpacing: '0.08em', fontWeight: 600 }}
        >
          時刻を決めて送る
        </span>
        <Reload onClick={load} busy={busy} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, fontSize: F.body }}>
        <NumberInput
          value={minutes}
          min={1}
          max={60 * 24 * 7}
          onChange={setMinutes}
          disabled={busy || panel.ended}
        />
        分後に
      </div>
      <Input
        placeholder="時刻が来たら送る依頼"
        value={prompt}
        disabled={busy || panel.ended}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <Button
        kind="primary"
        disabled={busy || panel.ended || prompt.trim() === ''}
        onClick={() =>
          void act(async () => {
            await window.izuna.addWakeup({ id: panel.id, minutes, prompt: prompt.trim() })
            setPrompt('')
          })
        }
      >
        予約する
      </Button>

      {list === null && <Loading />}
      {list?.length === 0 && <Faint>予約はありません</Faint>}
      {(list ?? []).map((w) => (
        <div
          key={w.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: S.xs,
            padding: `${S.sm}px ${S.md}px`,
            border: `1px solid ${w.state === 'overdue' ? C.amberLine : C.line}`,
            borderRadius: R.md
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md }}>
            <span
              style={{
                font: `${F.micro}px ${MONO}`,
                color: w.state === 'overdue' ? C.amber : C.dim2,
                flexShrink: 0
              }}
            >
              {WAKEUP_STATE_LABEL[w.state]}
              {w.state === 'pending' ? ` · ${until(w.fireAt, now)}` : ''}
            </span>
            <span style={{ fontSize: F.small, color: C.ink2, flexGrow: 1, ...ellipsis }}>
              {w.prompt}
            </span>
          </div>
          {(w.state === 'pending' || w.state === 'overdue') && (
            <div style={{ display: 'flex', gap: S.sm }}>
              {w.state === 'overdue' && !panel.ended && (
                <Button
                  size="sm"
                  kind="primary"
                  disabled={busy}
                  onClick={() => void act(() => window.izuna.fireWakeup(w.id))}
                >
                  いま送る
                </Button>
              )}
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void act(() => window.izuna.removeWakeup(w.id))}
              >
                消す
              </Button>
            </div>
          )}
        </div>
      ))}
      {failure && <span style={{ fontSize: F.small, color: C.red }}>{failure}</span>}
    </div>
  )
}
