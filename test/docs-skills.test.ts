import { describe, expect, it } from 'vitest'
import { docRequest, docSkills } from '../src/shared/docs'

/** 資料の skill を「資料」タブに出す形に読む（docs/FRAMEWORKS.md） */
describe('docSkills', () => {
  it('doc- で始まるものだけ。「資料 — 」と「(project)」を落とし、枠組みと説明に分け、名前順', () => {
    const got = docSkills([
      { name: 'verify', description: '検査を回す', argumentHint: '' },
      {
        name: 'doc-working-backwards',
        description: '資料 — Working Backwards（PR / FAQ）。先に書く (project)',
        argumentHint: '[何を出すか]'
      },
      {
        name: 'doc-impact-map',
        description: '資料 — Impact Mapping。木にする (project)',
        argumentHint: ''
      }
    ])
    expect(got).toEqual([
      { name: 'doc-impact-map', title: 'Impact Mapping', detail: '木にする', argumentHint: '' },
      {
        name: 'doc-working-backwards',
        title: 'Working Backwards（PR / FAQ）',
        detail: '先に書く',
        argumentHint: '[何を出すか]'
      }
    ])
  })

  it('約束の形でなくても壊れない（名前が題になる）', () => {
    expect(docSkills([{ name: 'doc-x', description: '', argumentHint: '' }])).toEqual([
      { name: 'doc-x', title: 'doc-x', detail: '', argumentHint: '' }
    ])
  })

  it('送る文はパレットで打つのと同じ', () => {
    const s = { name: 'doc-example-map', title: 'x', detail: '', argumentHint: '[Issue 番号]' }
    expect(docRequest(s, ' 12 ')).toBe('/doc-example-map 12')
    expect(docRequest(s, '')).toBe('/doc-example-map')
  })

  it('**画面に出すのは 1 文だけ。** description の後半は skill を選ぶための言葉で、人には出さない', () => {
    const [got] = docSkills([
      {
        name: 'doc-now-next-later',
        description:
          '資料 — Now / Next / Later のロードマップ。open な Issue を 3 列に並べる。期日は切らない。順番を整理したい、といった依頼で使う',
        argumentHint: ''
      }
    ])
    expect(got.title).toBe('Now / Next / Later のロードマップ')
    expect(got.detail).toBe('open な Issue を 3 列に並べる')
  })

  it('プラグインとして持ち込むと `izuna-docs:doc-…` で来る。札は後ろだけ、送るのは全体の名前', () => {
    const [got] = docSkills([
      {
        name: 'izuna-docs:doc-now-next-later',
        description: '(izuna-docs) 資料 — Now / Next / Later のロードマップ。3 列に並べる',
        argumentHint: ''
      }
    ])
    expect(got.name).toBe('izuna-docs:doc-now-next-later')
    expect(got.title).toBe('Now / Next / Later のロードマップ')
    expect(got.detail).toBe('3 列に並べる')
    expect(docRequest(got, '')).toBe('/izuna-docs:doc-now-next-later')
  })
})
