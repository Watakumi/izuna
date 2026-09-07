// 欧文が日本語の書体で描かれていないかを見る。
// **入っていない書体を先頭に置くと、次の候補（＝日本語の書体）が欧文まで描く。**
// 実際に IBM Plex Sans を指定していて 1 つも入っておらず、BIZ UDGothic の
// 欧文で全部描かれていた（細く幅広で読みにくい）。
// 幅が同じなら同じ書体。`scripts/shots.ts` から文字列として渡す。
(() => {
  const g = document.createElement('canvas').getContext('2d')
  const body = getComputedStyle(document.body).fontFamily
  const w = (font) => { g.font = '40px ' + font; return g.measureText('Reply with exactly').width }
  // 実際に使われている組みの、2 番目以降（＝日本語の受け持ち）だけを取り出す
  const parts = body.split(',').map((s) => s.trim())
  const japanese = parts.slice(1).join(', ') || 'sans-serif'
  return { body, actual: w(body), japaneseOnly: w(japanese), parts }
})()
