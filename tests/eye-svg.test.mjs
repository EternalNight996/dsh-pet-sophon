// 眼睛 SVG 生成的结构性单测。
//
// 这类"渲染代码"最容易出的问题是**静默产出坏 SVG**（标签不闭合、颜色 undefined、
// 皮肤名打错 → 浏览器直接把整张图吃掉）。这里把常见坏味道钉死。
// 同时生成一份离线预览页，供人工肉眼确认画面对不对。

import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { eyeSvg, auraSvg, pupilSvg } from '../core/eye-svg.mjs'
import { SKIN_ORDER, EYE_THEMES, PUPIL_SHAPES, skinOf, vesselsOf, skinLabel } from '../core/skins.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const previewDir = join(here, '..', 'preview')

test('皮肤表完整：每种皮肤都有虹膜三色、瞳孔形状、光晕色', () => {
  for (const [name, skin] of Object.entries(EYE_THEMES)) {
    assert.equal(Array.isArray(skin.iris) && skin.iris.length, 3, `${name} 的 iris 必须是三色`)
    for (const color of skin.iris) assert.match(color, /^#[0-9a-f]{6}$/i, `${name} 的虹膜色不是合法 hex: ${color}`)
    assert.ok(PUPIL_SHAPES.includes(skin.pupil), `${name} 的瞳孔形状未知: ${skin.pupil}`)
    assert.ok(typeof skin.glow === 'string' && skin.glow !== '', `${name} 缺 glow`)
    assert.ok(typeof skin.blood === 'number' && skin.blood >= 0 && skin.blood <= 1, `${name} 的 blood 越界`)
  }
})

test('SKIN_ORDER 里的每一项都在皮肤表里存在', () => {
  for (const name of SKIN_ORDER) {
    assert.ok(EYE_THEMES[name], `SKIN_ORDER 引用了不存在的皮肤: ${name}`)
    assert.equal(typeof skinLabel(name), 'string')
  }
})

test('未知皮肤名回落到原色，不抛错', () => {
  assert.equal(skinOf('nonexistent'), EYE_THEMES.cyan)
  assert.equal(skinOf(undefined), EYE_THEMES.cyan)
})

test('每种皮肤都能生成结构完整的 SVG（标签配平、无 undefined/NaN）', () => {
  for (const name of SKIN_ORDER) {
    const svg = eyeSvg(name, 200)
    assert.ok(svg.startsWith('\n<svg'), `${name}: SVG 应以 <svg 开头`)
    assert.ok(svg.trimEnd().endsWith('</svg>'), `${name}: SVG 应以 </svg> 结尾`)
    assert.equal((svg.match(/<svg/g) ?? []).length, 1, `${name}: 只能有一个根 svg`)
    assert.equal((svg.match(/<g[\s>]/g) ?? []).length, (svg.match(/<\/g>/g) ?? []).length, `${name}: <g> 不配平`)
    assert.equal((svg.match(/<defs>/g) ?? []).length, (svg.match(/<\/defs>/g) ?? []).length, `${name}: defs 不配平`)
    assert.equal((svg.match(/<clipPath/g) ?? []).length, (svg.match(/<\/clipPath>/g) ?? []).length, `${name}: clipPath 不配平`)
    assert.ok(!svg.includes('undefined'), `${name}: SVG 里出现了 undefined`)
    assert.ok(!svg.includes('NaN'), `${name}: SVG 里出现了 NaN`)
    assert.ok(!/#\[object/.test(svg), `${name}: 颜色计算异常`)
    // 关键结构件必须都在（用 class 而不是 id：id 带唯一后缀，class 才是稳定选择器）
    for (const cls of ['glow', 'body', 'iris', 'lid-top', 'lid-bottom']) {
      assert.ok(svg.includes(`class="${cls}"`), `${name}: 缺少 .${cls}`)
    }
    // 每只眼的 defs id 必须唯一（多 SVG 同文档时重名会互相污染）
    assert.ok(/id="sclera-e[0-9a-z]+"/.test(svg), `${name}: sclera 渐变 id 未加唯一后缀`)
  }
})

test('多只眼的 defs id 互不重复（同一文档里不能撞名）', () => {
  const a = eyeSvg('sophon', 200)
  const b = eyeSvg('sophon', 200)
  const idsOf = (svg) => [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
  const setA = new Set(idsOf(a))
  const setB = new Set(idsOf(b))
  for (const id of setA) {
    assert.equal(setB.has(id), false, `两只眼共享了 id: ${id}`)
  }
})

test('眼睑默认在睁开位置（移出画布）——早先的黑块 bug 的回归锚点', () => {
  const svg = eyeSvg('sophon', 200)
  // 闭眼位置是 translate(0, 0)；只要默认不是它，就不会一上来盖住眼睛
  assert.ok(!/class="lid-top" transform="translate\(0, 0\)"/.test(svg), '上眼睑默认不能停在闭眼位置')
  assert.ok(/class="lid-top" transform="translate\(0, -200\)"/.test(svg), '上眼睑默认应移出画布上方')
  assert.ok(/class="lid-bottom" transform="translate\(0, 200\)"/.test(svg), '下眼睑默认应移出画布下方')
})

test('血丝数量随 blood 强度变化，且不超过路径总数', () => {
  assert.equal(vesselsOf({ blood: 0 }).length, 0)
  assert.equal(vesselsOf({ blood: 1 }).length, 10)
  assert.equal(vesselsOf({ blood: 0.5 }).length, 5)
  assert.ok(vesselsOf({ blood: 5 }).length <= 10, 'blood 越界时不得超出路径总数')
})

test('所有瞳孔形状都能生成，且未知形状回落到圆瞳', () => {
  for (const shape of PUPIL_SHAPES) {
    const out = pupilSvg(shape, false)
    assert.ok(typeof out === 'string' && out.length > 0, `${shape} 生成为空`)
    assert.ok(!out.includes('undefined'), `${shape} 含 undefined`)
  }
  assert.ok(pupilSvg('nope', false).includes('ellipse'), '未知形状应回落到圆瞳')
})

test('所有光环类型都能生成（含 none）', () => {
  for (const aura of ['none', 'star', 'blood', 'wraith', 'ash', 'ember', 'abyss', 'pale', undefined]) {
    const out = auraSvg({ aura })
    assert.ok(typeof out === 'string', `${aura} 未返回字符串`)
    assert.ok(!out.includes('undefined'), `${aura} 含 undefined`)
  }
  assert.equal(auraSvg({ aura: 'none' }), '')
  assert.equal(auraSvg({ aura: undefined }), '')
})

test('生成离线预览页（人工肉眼确认用）', () => {
  mkdirSync(previewDir, { recursive: true })
  const cards = SKIN_ORDER.map((name) => {
    const skin = EYE_THEMES[name]
    return `<figure><div class="eye">${eyeSvg(name, 200)}</div><figcaption>${skinLabel(name)} <code>${name}</code></figcaption></figure>`
  }).join('\n')
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>智子桌面宠物 · 皮肤预览</title>
<style>
  body { background: #0b0f14; color: #e5e7eb; font: 14px/1.5 "Segoe UI", "Microsoft YaHei", sans-serif; margin: 24px; }
  h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
  p { color: #94a3b8; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
  figure { margin: 0; text-align: center; background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 12px; }
  .eye { display: flex; justify-content: center; }
  figcaption { margin-top: 8px; font-size: 12px; color: #cbd5e1; }
  code { color: #64748b; }
  @keyframes pet-halo { 0%,100% { opacity: 0.35; transform: scale(1); } 50% { opacity: 0.85; transform: scale(1.14); } }
  @keyframes pet-aura-spin { from { transform: rotate(0deg) scale(1); } to { transform: rotate(360deg) scale(1.1); } }
  @keyframes pet-spark { 0%,100% { opacity: 0; } 45% { opacity: 0; } 50% { opacity: 1; } 58% { opacity: 0.2; } 66% { opacity: 0.9; } }
  @keyframes pet-ash { 0% { transform: translateY(0); opacity: 0.6; } 100% { transform: translateY(26px); opacity: 0; } }
  @keyframes pet-ember { 0% { transform: translateY(0) scale(1); opacity: 0.8; } 100% { transform: translateY(-28px) scale(0.25); opacity: 0; } }
  #glow { animation: pet-halo 3.4s ease-in-out infinite; transform-origin: 100px 100px; }
  .aura { animation: pet-aura-spin 9s linear infinite; transform-origin: 100px 100px; }
  .spark { animation: pet-spark 2.6s linear infinite; }
  .ash { animation: pet-ash 3.2s linear infinite; }
  .ember { animation: pet-ember 2.4s ease-out infinite; }
</style></head>
<body>
  <h1>智子桌面宠物 · 皮肤预览</h1>
  <p>共 ${SKIN_ORDER.length} 款皮肤。此页由 <code>tests/eye-svg.test.mjs</code> 自动生成，用于肉眼确认画面。</p>
  <div class="grid">
${cards}
  </div>
</body></html>`
  writeFileSync(join(previewDir, 'skins.html'), html, 'utf8')
  assert.ok(true)
})
