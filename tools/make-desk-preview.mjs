// 生成「宠物在桌面上的效果」预览页（人工肉眼确认用）。
// 用法：node tools/make-desk-preview.mjs [皮肤名]

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { eyeSvg } from '../core/eye-svg.mjs'
import { SKIN_ORDER, skinLabel } from '../core/skins.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'preview')
mkdirSync(out, { recursive: true })

const skin = process.argv[2] ?? 'sophon'

const pets = SKIN_ORDER.map((name, index) => {
  const left = 40 + (index % 6) * 240
  const top = 40 + Math.floor(index / 6) * 260
  return `<div class="pet" style="left:${left}px;top:${top}px">${eyeSvg(name, 200)}</div>
<div class="cap" style="left:${left}px;top:${top + 208}px">${skinLabel(name)}</div>`
}).join('\n')

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>智子桌面宠物 · 桌面效果</title>
<style>
  html, body { margin: 0; height: 100%; }
  body {
    background: linear-gradient(135deg, #1e293b 0%, #0f172a 55%, #020617 100%);
    position: relative; overflow: hidden;
    font: 12px/1.4 "Segoe UI", "Microsoft YaHei", sans-serif;
  }
  .desk { position: absolute; inset: 0;
    background-image:
      radial-gradient(circle at 20% 30%, rgba(148,163,184,.08), transparent 40%),
      radial-gradient(circle at 75% 70%, rgba(99,102,241,.10), transparent 45%); }
  .app { position: absolute; left: 40px; top: 40px; width: 320px; height: 210px;
    background: #111827; border: 1px solid #1f2937; border-radius: 10px;
    box-shadow: 0 18px 40px rgba(0,0,0,.5); }
  .app .bar { height: 26px; background: #1f2937; border-radius: 10px 10px 0 0; }
  .app .line { height: 9px; margin: 12px 14px; background: #1f2937; border-radius: 4px; }
  .pet { position: absolute; width: 200px; height: 200px;
    filter: drop-shadow(0 12px 22px rgba(0,0,0,.55)); }
  .cap { position: absolute; width: 200px; text-align: center; color: #94a3b8; }
  .label { position: absolute; left: 40px; top: 268px; }
  .label span { display: inline-block; padding: 3px 9px; border-radius: 999px;
    background: rgba(17,24,39,.75); border: 1px solid rgba(148,163,184,.28); color: #e5e7eb; font-size: 11px; }
  h1 { position: absolute; left: 40px; top: 300px; color: #64748b; font-size: 12px; font-weight: 400; }
</style></head>
<body>
  <div class="desk"></div>
  <div class="app"><div class="bar"></div><div class="line" style="width:70%"></div><div class="line" style="width:86%"></div><div class="line" style="width:52%"></div><div class="line" style="width:64%"></div></div>
  <div class="label"><span>3/8 · 38% · 写渲染层</span></div>
  ${pets}
  <h1>智子桌面宠物 · 皮肤在桌面上的实际效果（当前高亮：${skinLabel(skin)}）</h1>
</body></html>`

writeFileSync(join(out, 'desk.html'), html, 'utf8')
console.log(`[preview] ${join(out, 'desk.html')}`)
