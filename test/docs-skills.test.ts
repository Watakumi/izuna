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
})
