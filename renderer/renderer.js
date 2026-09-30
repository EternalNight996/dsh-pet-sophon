// 渲染层：把主进程推来的帧画成「智子的眼睛」。
//
// 两种模式（由 URL query 决定）：
//   mode=overlay —— 画宠物本体 + 头顶进度；窗口鼠标穿透，不接收鼠标。
//                  每块显示器各有一个 overlay，渲染层按 visible 决定画不画。
//   mode=hitbox  —— 一个透明的可点小圆，负责接收点击/拖拽/右键，再发给主进程。
//
// 眼睛的 SVG 由 ../core/eye-svg.mjs 生成（纯函数、可单测）；视线偏移与眨眼在这里
// 用 transform / class 控制——GPU 合成，不触发重排。

import { eyeSvg } from '../core/eye-svg.mjs'

const params = new URLSearchParams(location.search)
const mode = params.get('mode') ?? 'overlay'

const petEl = document.getElementById('pet')
const labelEl = document.getElementById('label')
const hitEl = document.getElementById('hit')

/** 当前帧（由主进程推送）。 */
let frame = {
  x: 0, y: 0, size: 200, hitSize: 96,
  facing: 1, gazeX: 0, gazeY: 0, eyesClosed: false,
  mood: 'idle', skin: 'sophon', connected: false, title: '',
}

/** 鼠标绝对坐标（用于把视线换算成瞳孔偏移）。 */
let cursor = null

/** 当前已渲染的皮肤（避免每帧重建 SVG）。 */
let currentSkin = null
let irisGroup = null
let lids = null

// ── overlay 模式 ───────────────────────────────────────────────────────────

function mountOverlay() {
  petEl.hidden = false
  labelEl.hidden = true
  document.body.classList.add('mood-idle')
}

/** 皮肤变化时重建 SVG。 */
function ensureSkin(skin, size) {
  if (currentSkin === skin && petEl.firstElementChild) return
  currentSkin = skin
  petEl.style.width = `${size}px`
  petEl.style.height = `${size}px`
  petEl.innerHTML = eyeSvg(skin, size)
  irisGroup = petEl.querySelector('.iris')
  lids = {
    top: petEl.querySelector('.lid-top'),
    bottom: petEl.querySelector('.lid-bottom'),
  }
}

/**
 * 应用一帧。
 * @param {object} next { rel, visible, area, frame }
 */
function applyFrame(next) {
  frame = { ...frame, ...(next.frame ?? {}) }

  // 不在本屏范围：直接不画（否则每块屏都会冒出一只宠物）
  if (next.visible === false) {
    petEl.hidden = true
    labelEl.hidden = true
    return
  }

  petEl.hidden = false
  ensureSkin(frame.skin, frame.size)

  const rel = next.rel ?? { x: 0, y: 0 }
  petEl.style.transform = `translate(${rel.x}px, ${rel.y}px)`

  // 情绪 class 驱动呼吸 / 光晕节奏
  document.body.classList.remove('mood-idle', 'mood-working', 'mood-dormant')
  document.body.classList.add(`mood-${frame.mood}`)

  // 眨眼 / 休眠：合上上下眼睑（睁开 = 移出画布 ±200，与 core/eye-svg.mjs 约定一致）
  if (lids) {
    const closed = frame.eyesClosed === true
    lids.top.setAttribute('transform', closed ? 'translate(0, 0)' : 'translate(0, -200)')
    lids.bottom.setAttribute('transform', closed ? 'translate(0, 0)' : 'translate(0, 200)')
    lids.top.style.transition = 'transform 0.09s ease'
    lids.bottom.style.transition = 'transform 0.09s ease'
  }

  // 头顶进度
  const text = frame.title ?? ''
  labelEl.textContent = text
  labelEl.hidden = text === ''
  labelEl.style.top = `${Math.max(0, rel.y - 26)}px`
  labelEl.style.left = `${rel.x + frame.size / 2}px`
  labelEl.classList.toggle('offline', frame.connected !== true)

  applyGaze()
}

/** 视线：鼠标坐标 → 瞳孔偏移（限制在 ±10px，超出就像眼珠掉出来）。 */
function applyGaze() {
  if (!irisGroup) return
  let gx = frame.gazeX ?? 0
  let gy = frame.gazeY ?? 0
  if (cursor && Number.isFinite(frame.x)) {
    const cx = frame.x + frame.size / 2
    const cy = frame.y + frame.size / 2
    gx = clamp((cursor.x - cx) / 420, -1, 1)
    gy = clamp((cursor.y - cy) / 420, -1, 1)
  }
  irisGroup.setAttribute('transform', `translate(${(gx * 10).toFixed(2)}, ${(gy * 8).toFixed(2)})`)
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

// ── hitbox 模式 ────────────────────────────────────────────────────────────

function mountHitbox() {
  hitEl.hidden = false
  // hitbox 窗口本身就是可点区域，铺满整个窗口
  hitEl.style.inset = '0'
  // 调试开关：加 ?debug=1 可看到可点区域
  if (params.get('debug') === '1') hitEl.classList.add('debug')

  let dragging = false
  let moved = false
  let downAt = null

  hitEl.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    dragging = true
    moved = false
    downAt = { x: event.screenX, y: event.screenY }
    window.pet?.dragStart({ x: event.screenX, y: event.screenY })
  })
  hitEl.addEventListener('mousemove', () => {
    if (!dragging) return
    moved = true
    window.pet?.dragMove()
  })
  window.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    window.pet?.dragEnd()
  })
  hitEl.addEventListener('click', () => {
    if (moved) {
      moved = false
      return
    }
    void downAt
    window.pet?.click()
  })
  hitEl.addEventListener('dblclick', () => window.pet?.openDsh())
  hitEl.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    window.pet?.contextMenu()
  })
}

// ── 装配 ───────────────────────────────────────────────────────────────────

if (mode === 'hitbox') {
  mountHitbox()
  window.pet?.ready?.('hitbox')
} else {
  mountOverlay()
  window.pet?.onFrame(applyFrame)
  window.pet?.onCursor((point) => {
    cursor = point
    applyGaze()
  })
  window.pet?.ready?.('overlay')
  // 渲染层异常上报（否则失败是完全静默的）
  window.addEventListener('error', (event) => window.pet?.ready?.(`error:${event.message}`))
  window.addEventListener('unhandledrejection', (event) => window.pet?.ready?.(`rejection:${String(event.reason)}`))
}
