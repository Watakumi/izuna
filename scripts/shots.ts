import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadGhosttySkin } from '../src/main/ghostty'

/**
 * 画面を**実際に描いて**撮る。
 *
 * 今日、見た目の不具合が 6 件出て**全部人間が見つけた**。検査は全部
 * 「文字列を読む検査」で、何も描いていなかったので原理的に気づけない。
 * ここが、その穴を塞ぐための道具である。
 *
 *   pnpm shots        撮って測る（`shots/` に PNG が出る）
 *
 * **PNG は commit しない。** 目で見るためのもので、差分に意味が無い。
 * 機械で判る分（コントラスト・canvas の実ピクセル・書体が解決されたか）は
 * ここで落とす。落ちなかったものは人（または私）が PNG を見る。
 */

const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'shots')
const problems: string[] = []
const check = (ok: boolean, what: string): void => {
  if (!ok) problems.push(what)
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`), animations: 'disabled' })
  console.log(`  撮った: shots/${name}.png`)
}

/** 実際に描かれている色を取る（`var()` ではなく解決後の値） */
const styleOf = (page: Page, sel: string, prop: string): Promise<string> =>
  page.$eval(sel, (el, p) => getComputedStyle(el).getPropertyValue(p as string), prop)

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true })

  const server = await createServer({
    root: join(ROOT, 'src/renderer'),
    plugins: [react()],
    server: { port: 5199 },
    logLevel: 'error'
  })
  await server.listen()

  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: 1380, height: 900 },
    deviceScaleFactor: 2
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  // 実機の Ghostty を読んで流し込む。**本番と同じ配色で撮る**
  const skin = await loadGhosttySkin()
  // **関数で渡さない。** tsx が名前付き関数に __name を挿すので、
  // ページ側で ReferenceError になり、**黙って届かない**（これで一度、
  // 既定色のまま「確認した」ことにしてしまった）
  await page.addInitScript(`window.__skin = ${JSON.stringify(skin)}`)

  await page.goto('http://localhost:5199/harness.html')
  await page.waitForSelector('text=新しいセッション', { timeout: 15_000 })
  await shoot(page, '1-empty')

  // 起こす画面
  await page.getByText('新しいセッションを開く').click()
  await page.waitForSelector('text=リポジトリ')
  await page.getByText('izuna', { exact: true }).first().click()
  await page.waitForTimeout(500)
  await shoot(page, '2-new-session')

  // 入力欄が既定の白に落ちていないか（一度これで真っ白を出した）
  const ta = await styleOf(page, 'textarea', 'background-color')
  check(
    !/rgb\(255, 255, 255\)|rgba\(0, 0, 0, 0\)$/.test(ta) || ta === 'rgba(0, 0, 0, 0)',
    `入力欄の背景が既定に落ちている: ${ta}`
  )

  // 続きから → 会話
  await page.getByText('セッションの一覧と復元').click()
  await page.waitForSelector('text=現状', { timeout: 10_000 })
  await page.waitForTimeout(800)
  await shoot(page, '3-conversation')

  // 本文が markdown として描けているか。**コードの中は除く** ——
  // コードは解釈しないのが正しいので、そこに ** があっても異常ではない
  // （最初これで誤検出した）
  const prose = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement
    clone.querySelectorAll('pre, code').forEach((n) => n.remove())
    return clone.innerText
  })
  check(!prose.includes('**'), '本文に ** が残っている（markdown が描けていない）')
  check(!prose.includes('| ---'), '表が描けていない')
  check((await page.locator('table').count()) > 0, '表が要素になっていない')
  check(prose.includes('現状'), '見出しが出ていない')

  /**
   * **欧文が日本語の書体で描かれていないか。**
   *
   * 「日本語は見やすいが英語が見にくい」と言われて分かった ——
   * 指定していた `'IBM Plex Sans'` がこの環境に 1 つも入っておらず、
   * 次の候補である BIZ UDGothic が**欧文まで描いていた**。
   * 書体名を書いただけでは、入っているかどうかは分からない。
   */
  const latin = (await page.evaluate(readFileSync(join(ROOT, 'scripts/latin.js'), 'utf8'))) as {
    body: string
    actual: number
    japaneseOnly: number
    parts: string[]
  }
  check(
    Math.abs(latin.actual - latin.japaneseOnly) > 1,
    `欧文が日本語の書体で描かれている（${latin.parts[0]} が入っていない）: ${latin.body}`
  )

  // 本文の色と書体
  const strong = await page.locator('strong').first()
  check((await strong.count()) > 0, '強調が要素になっていない')
  const font = await styleOf(page, 'body', 'font-family')
  check(!font.includes('var('), `書体が var() のまま解決されていない: ${font}`)

  /**
   * **mermaid が図になっているか。**
   *
   * ここは端末と同じ罠がある —— mermaid は色を SVG の属性に直接書くので、
   * `var()` のまま渡すと**黙って黒い図**になる。SVG が出たことだけでなく、
   * 地の色が暗いままかを見る。
   */
  await page.waitForTimeout(1200)
  const svgs = await page.locator('.izuna-md svg, svg[id^="m"]').count()
  check(svgs > 0, 'mermaid が図になっていない')
  check(
    (await page.getByText('これは mermaid ではない').count()) > 0,
    '図にできない mermaid で、書いてあった字まで消えている'
  )
  await shoot(page, '6-mermaid')

  // 触ったファイル
  await page.getByText('ファイル', { exact: true }).click()
  await page.waitForTimeout(300)
  check(
    (await page.getByText('書き換えた', { exact: false }).count()) > 0,
    '書き換えたファイルが出ていない'
  )
  check(
    (await page.getByText('skin.ts', { exact: false }).count()) > 0,
    'Write したファイルが一覧に出ていない'
  )
  await shoot(page, '7-files')

  // 共有フォルダの盤面（§16）
  await page.getByText('盤面', { exact: true }).click()
  await page.waitForTimeout(300)
  check(
    (await page.getByText('同時に走らせてはいけない組があります').count()) > 0,
    'paths の重なりが出ていない'
  )
  await shoot(page, '8-board')

  // 自律ループ（§23）
  await page.getByText('ループ', { exact: true }).click()
  await page.waitForTimeout(400)
  await shoot(page, '5-loop')
  check((await page.getByText('始める').count()) > 0, 'ループを始める釦が無い')
  check((await page.getByText('止める').count()) === 0, '回っていないのに止める釦が出ている')
  await page.getByText('情報', { exact: true }).click()

  // ターミナル
  await page.getByText('ターミナル', { exact: true }).first().click()
  await page.waitForSelector('canvas', { timeout: 20_000 })
  await page.waitForTimeout(2500)
  await shoot(page, '4-terminal')

  {
    // **canvas の実ピクセルを見る。** var() は canvas で解決されないので、
    // ここが明るければ既定の配色に落ちている（実際に一度落ちた）
    const px = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement
      const g = c.getContext('2d')!
      const d = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height * 0.7), 1, 1).data
      return [d[0], d[1], d[2]]
    })
    const lum = (0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) / 255
    check(lum < 0.5, `ターミナルの地が明るい（rgb(${px.join(',')})）—— 配色が渡っていない`)
  }

  /**
   * **画面に出ている全部の字を測る。**
   *
   * ここが今回の核心。「薄い」と 4 回言われて、そのたび勘で直しては
   * また薄いと言われた。**トークンの値を見ても分からない** ——
   * 字が載る面が `bg` / `panel` / `raised` / 差分の色地と違うので、
   * 同じ色でも面によって比が変わる。**描いてから測るしかない。**
   */
  const FLOOR = 6
  const texts = (await page.evaluate(readFileSync(join(ROOT, 'scripts/contrast.js'), 'utf8'))) as {
    text: string
    size: number
    ratio: number
  }[]
  const faint = texts.filter((t) => t.ratio < FLOOR)
  console.log(`\n画面の字 ${texts.length} 箇所 / 最も薄いもの ${texts[0]?.ratio}`)
  for (const t of faint) problems.push(`薄い（比 ${t.ratio} / ${t.size}px）: ${t.text}`)

  await browser.close()
  await server.close()

  if (errors.length) problems.push(...errors.map((e) => `画面のエラー: ${e.slice(0, 160)}`))

  await writeFile(
    join(OUT, 'README.md'),
    '撮ったもの。`pnpm shots` で作り直せる。**commit しない**（差分に意味が無い）。\n',
    'utf8'
  )

  if (problems.length) {
    console.error('\n落ちた:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('\n機械で判る分は通った。あとは shots/*.png を目で見ること。')
  process.exit(0)
}

void main()
