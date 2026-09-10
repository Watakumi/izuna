/* eslint-disable @typescript-eslint/explicit-function-return-type -- 型の無い .js/.mjs */
// 画面に出ている全部の字の、実際のコントラスト比を返す（薄い順）。
// **面ごとに地の色が違う**ので、トークンの値を見るだけでは分からない。
// `scripts/shots.ts` から `page.evaluate` に文字列として渡す。
;(() => {
  const parse = (c) =>
    c
      .slice(c.indexOf('(') + 1)
      .split(')')[0]
      .split(',')
      .map((v) => parseFloat(v))
  const lum = (c) => {
    const p = parse(c)
    const f = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2])
  }
  const bgOf = (el) => {
    let n = el
    while (n) {
      const c = getComputedStyle(n).backgroundColor
      const p = parse(c)
      if (p.length < 4 || p[3] > 0.5) return c
      n = n.parentElement
    }
    return 'rgb(20, 22, 27)'
  }
  const out = []
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length > 0) continue
    const text = el.innerText ? el.innerText.trim() : ''
    if (!text) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.opacity === '0') continue
    const a = lum(s.color)
    const b = lum(bgOf(el))
    out.push({
      text: text.replace(/\s+/g, ' ').slice(0, 26),
      size: parseFloat(s.fontSize),
      weight: s.fontWeight,
      ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100
    })
  }
  return out.sort((x, y) => x.ratio - y.ratio)
})()
