// 智子眼睛的 SVG 生成（纯字符串拼接，零依赖、可单测、可离线预览）。
//
// 结构参照 dsh-ui-three-body 的 3D 眼球：外光晕 → 皮肤光环 → 眼白 → 血丝/眼睑阴影
// → 虹膜 + 瞳孔（视线只转这一组）→ 高光 → 上下眼睑 → 高光边。
//
// 关键实现细节（踩过坑，别改回去）：
//   1) 上下眼睑用 clipPath 限定在眼球轮廓内，且**睁开位置是 translate(0, ∓200)**——
//      把眼皮移到画布外。早先的写法让两片黑色半圆停在合上位置，直接把整只眼睛盖成黑块。
//   2) 每只眼的 defs id 带唯一后缀：多个 SVG 出现在同一个文档里时（预览页、多宠物），
//      重名 id 会让第一个 SVG 的渐变/裁剪定义污染其余所有眼。
//   3) 颜色/尺寸全部由皮肤数据驱动，不硬编码。

import { skinOf, vesselsOf } from './skins.mjs'

/** 闭环位移：把眼皮移到眼球之外。 */
export const LID_OPEN_OFFSET = 200

let uidCounter = 0

/**
 * 生成一只眼睛的 SVG。
 * @param {string} skinName 皮肤名。
 * @param {number} size 画布尺寸（像素）。
 * @returns {string} SVG 标记。
 */
export function eyeSvg(skinName, size) {
  const skin = skinOf(skinName)
  const [irisLight, irisMid, irisDark] = skin.iris
  const fierce = skin.fierce === true
  const uid = `e${(uidCounter += 1).toString(36)}`
  const id = (name) => `${name}-${uid}`

  const vesselPaths = vesselsOf(skin)
    .map((d) => `<path d="${d}" stroke="rgba(190,40,40,0.55)" stroke-width="0.9" fill="none" stroke-linecap="round"/>`)
    .join('')

  return `
<svg width="${size}" height="${size}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="${id('sclera')}" cx="50%" cy="42%" r="62%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="70%" stop-color="#f1f3f6"/>
      <stop offset="100%" stop-color="#c8ced8"/>
    </radialGradient>
    <radialGradient id="${id('iris')}" cx="42%" cy="38%" r="70%">
      <stop offset="0%" stop-color="${irisLight}"/>
      <stop offset="55%" stop-color="${irisMid}"/>
      <stop offset="100%" stop-color="${irisDark}"/>
    </radialGradient>
    <radialGradient id="${id('glow')}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${skin.glow}"/>
      <stop offset="60%" stop-color="${skin.glow}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${skin.glow}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="${id('eyeClip')}"><ellipse cx="100" cy="99" rx="86" ry="62"/></clipPath>
  </defs>

  <ellipse class="glow" cx="100" cy="100" rx="98" ry="80" fill="url(#${id('glow')})"/>
  ${auraSvg(skin, id)}

  <g class="body">
    <ellipse cx="100" cy="100" rx="88" ry="64" fill="rgba(15,23,42,0.28)"/>
    <ellipse cx="100" cy="99" rx="86" ry="62" fill="url(#${id('sclera')})"/>

    <!-- 血丝与眼睑阴影都裁在眼球内 -->
    <g clip-path="url(#${id('eyeClip')})">
      ${vesselPaths}
      <ellipse cx="100" cy="30" rx="96" ry="28" fill="rgba(15,23,42,0.14)"/>
      <ellipse cx="100" cy="170" rx="96" ry="24" fill="rgba(15,23,42,0.10)"/>
    </g>

    <!-- 虹膜 + 瞳孔：视线只转这一组 -->
    <g class="iris">
      <ellipse cx="100" cy="100" rx="40" ry="40" fill="url(#${id('iris')})"/>
      <ellipse cx="100" cy="100" rx="40" ry="40" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="2"/>
      ${pupilSvg(skin.pupil, fierce)}
      <ellipse cx="86" cy="84" rx="11" ry="9" fill="rgba(255,255,255,0.9)"/>
      <ellipse cx="112" cy="114" rx="5" ry="4" fill="rgba(255,255,255,0.5)"/>
    </g>

    <!-- 上下眼睑：默认移出画布（睁开）；闭眼时回到 translate(0,0) -->
    <g clip-path="url(#${id('eyeClip')})">
      <path class="lid-top" transform="translate(0, ${-LID_OPEN_OFFSET})" d="M 4 99 Q 100 -40 196 99 Z" fill="#12161f"/>
      <path class="lid-bottom" transform="translate(0, ${LID_OPEN_OFFSET})" d="M 4 99 Q 100 238 196 99 Z" fill="#12161f"/>
    </g>

    <ellipse cx="100" cy="99" rx="86" ry="62" fill="none" stroke="rgba(255,255,255,0.20)" stroke-width="1.6"/>
  </g>
</svg>`
}

/** 皮肤光环：星野 / 血雾 / 灰烬 / 火舌 / 深渊 / 苍白。 */
export function auraSvg(skin, id = (name) => name) {
  const aura = skin.aura
  if (aura === 'none' || aura === undefined) return ''
  if (aura === 'star') {
    const sparks = Array.from({ length: 9 }, (_, i) => {
      const angle = (i / 9) * Math.PI * 2
      const r = 74 + (i % 3) * 8
      const x = (100 + Math.cos(angle) * r).toFixed(1)
      const y = (100 + Math.sin(angle) * r * 0.72).toFixed(1)
      const radius = (1.1 + (i % 2) * 0.6).toFixed(1)
      return `<circle class="spark" cx="${x}" cy="${y}" r="${radius}" fill="#c7d2fe" style="animation-delay:${(i * 0.28).toFixed(2)}s"/>`
    }).join('')
    return `<g class="aura" opacity="0.7">${sparks}</g>`
  }
  if (aura === 'blood' || aura === 'wraith') {
    return '<g class="aura" opacity="0.55"><circle cx="100" cy="100" r="82" fill="none" stroke="rgba(190,30,30,0.35)" stroke-width="2" stroke-dasharray="6 12"/><circle cx="100" cy="100" r="92" fill="none" stroke="rgba(190,30,30,0.18)" stroke-width="1.2" stroke-dasharray="3 16"/></g>'
  }
  if (aura === 'ash') {
    return `<g class="aura" opacity="0.6">${[30, 70, 120, 165]
      .map((x, i) => `<circle class="ash" cx="${x}" cy="60" r="2.2" fill="rgba(203,213,225,0.7)" style="animation-delay:${(i * 0.7).toFixed(2)}s"/>`)
      .join('')}</g>`
  }
  if (aura === 'ember') {
    return `<g class="aura" opacity="0.75">${[46, 92, 140]
      .map((x, i) => `<circle class="ember" cx="${x}" cy="140" r="3" fill="rgba(248,113,113,0.85)" style="animation-delay:${(i * 0.6).toFixed(2)}s"/>`)
      .join('')}</g>`
  }
  if (aura === 'abyss') {
    return '<g class="aura" opacity="0.5"><ellipse cx="100" cy="100" rx="94" ry="70" fill="none" stroke="rgba(79,70,229,0.4)" stroke-width="3" stroke-dasharray="1 10"/></g>'
  }
  if (aura === 'pale') {
    return '<g class="aura" opacity="0.45"><ellipse cx="100" cy="100" rx="92" ry="68" fill="none" stroke="rgba(199,210,254,0.35)" stroke-width="2"/></g>'
  }
  void id
  return ''
}

/** 瞳孔形状。 */
export function pupilSvg(pupil, fierce) {
  switch (pupil) {
    case 'slit':
      return '<ellipse cx="100" cy="100" rx="9" ry="30" fill="#05070b"/>'
    case 'ring':
      return '<ellipse cx="100" cy="100" rx="30" ry="30" fill="none" stroke="#05070b" stroke-width="9"/><ellipse cx="100" cy="100" rx="12" ry="12" fill="#05070b"/>'
    case 'sharingan': {
      const tomoe = [0, 120, 240].map((a) => `<g transform="rotate(${a} 100 100)"><circle cx="100" cy="78" r="5" fill="#05070b"/><path d="M 96 82 q 4 10 12 12 q -10 2 -12 -12 z" fill="#05070b"/></g>`).join('')
      return `<ellipse cx="100" cy="100" rx="11" ry="11" fill="#05070b"/><g class="ring">${tomoe}</g>`
    }
    case 'mangekyo': {
      const blades = [0, 90, 180, 270].map((a) => `<path transform="rotate(${a} 100 100)" d="M 100 100 L 132 82 Q 118 100 132 118 Z" fill="#05070b"/>`).join('')
      return `<ellipse cx="100" cy="100" rx="10" ry="10" fill="#05070b"/><g class="ring">${blades}</g>`
    }
    case 'rinnegan': {
      const rings = [16, 24, 32].map((r) => `<circle cx="100" cy="100" r="${r}" fill="none" stroke="#05070b" stroke-width="2.4" stroke-opacity="0.75"/>`).join('')
      return `<ellipse cx="100" cy="100" rx="9" ry="9" fill="#05070b"/>${rings}`
    }
    case 'sophon':
      return '<g class="ring"><circle cx="100" cy="100" r="17" fill="none" stroke="#05070b" stroke-width="3"/><path d="M 100 83 L 114 100 L 100 117 L 86 100 Z" fill="#05070b"/></g>'
    case 'byakugan':
      return '<ellipse cx="100" cy="100" rx="26" ry="26" fill="rgba(255,255,255,0.9)" stroke="rgba(99,102,241,0.5)" stroke-width="2"/><ellipse cx="100" cy="100" rx="10" ry="10" fill="rgba(99,102,241,0.75)"/>'
    default: {
      const r = fierce ? 15 : 17
      return `<ellipse cx="100" cy="100" rx="${r}" ry="${r}" fill="#05070b"/>`
    }
  }
}
