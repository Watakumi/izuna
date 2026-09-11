import { describe, expect, it } from 'vitest'
import { PLUGIN_NAME, pluginPath } from '../src/shared/plugin'

/**
 * Izuna が同梱するプラグインの置き場（§33）。**asar の中を指さない。**
 * 指すと claude が読めず、skill が黙って出なくなる
 */
describe('pluginPath', () => {
  it('開発では、出力の親の resources を指す', () => {
    expect(pluginPath('/Users/someone/work/izuna')).toBe(
      `/Users/someone/work/izuna/resources/${PLUGIN_NAME}`
    )
  })

  it('配布物では asar ではなく、展開された側を指す（asarUnpack: resources/**）', () => {
    expect(pluginPath('/Applications/Izuna.app/Contents/Resources/app.asar')).toBe(
      `/Applications/Izuna.app/Contents/Resources/app.asar.unpacked/resources/${PLUGIN_NAME}`
    )
  })

  it('パスの途中の app.asar も置き換える。末尾の / は増やさない', () => {
    expect(pluginPath('/x/app.asar/')).toBe(`/x/app.asar.unpacked/resources/${PLUGIN_NAME}`)
    // 名前の一部が app.asar で始まるだけのものは置き換えない
    expect(pluginPath('/x/app.asarbak')).toBe(`/x/app.asarbak/resources/${PLUGIN_NAME}`)
  })
})
