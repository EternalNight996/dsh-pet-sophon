// 智子行为核心（纯逻辑、零依赖、可单测）。
//
// 职责：决定宠物「下一帧」的状态——位置、朝向、视线、情绪、闪现。
// 刻意与 Electron / DOM 解耦：主进程只管把这里算出的 x/y 应用到窗口上，
// 渲染进程只管按 gaze/mood 画眼睛。这样行为逻辑可以用 node:test 直接验证。

/** 情绪档位：由 DSH 会话状态驱动。 */
export const MOOD = {
  /** 没有任何 DSH 会话活动：闭眼休眠、移动缓慢。 */
  DORMANT: 'dormant',
  /** 有会话但没有正在执行的轮次：待命、偶尔东张西望。 */
  IDLE: 'idle',
  /** 会话正在执行：活跃、移动快、瞳孔聚焦。 */
  WORKING: 'working',
}

/**
 * 创建一个宠物实例。
 * @param {object} [options] 初始参数。
 * @param {number} [options.x] 初始 x（屏幕坐标）。
 * @param {number} [options.y] 初始 y。
 * @param {string} [options.mood] 初始情绪。
 * @param {() => number} [options.random] 注入的随机源，便于测试确定性。
 * @returns {object} 宠物状态与步进函数。
 */
export function createPet(options = {}) {
  const random = options.random ?? Math.random
  return {
    /** 当前屏幕坐标（窗口左上角）。 */
    x: options.x ?? 0,
    y: options.y ?? 0,
    /** 速度（像素/秒）。 */
    vx: 0,
    vy: 0,
    /** 朝向：-1 向左，1 向右。 */
    facing: 1,
    /** 视线偏移（-1..1 的归一化值），渲染层据此转动瞳孔。 */
    gazeX: 0,
    gazeY: 0,
    /** 情绪。 */
    mood: options.mood ?? MOOD.IDLE,
    /** 是否闭眼（眨眼/休眠）。 */
    eyesClosed: false,
    /** 距下一次眨眼/换向的剩余秒数。 */
    blinkIn: 1 + random() * 3,
    repickIn: 2 + random() * 3,
    /** 统计：走了多少像素（便于观察是否真的在游荡）。 */
    distance: 0,
    random,
  }
}

/** 各情绪的运动参数：速度上限与「多久重新挑一次目标」。 */
const MOTION = {
  [MOOD.DORMANT]: { speed: 6, repick: [6, 14], bob: 0.25 },
  [MOOD.IDLE]: { speed: 26, repick: [2.5, 6], bob: 1 },
  [MOOD.WORKING]: { speed: 64, repick: [1.2, 3], bob: 1.6 },
}

/**
 * 推进一帧。
 * @param {object} pet createPet 返回的实例（就地修改）。
 * @param {number} dt 距上一帧的秒数。
 * @param {object} world 世界描述。
 * @param {{x:number,y:number,width:number,height:number}} world.bounds 当前显示器可用区域（窗口左上角可达范围）。
 * @param {{x:number,y:number}} [world.lookAt] 鼠标位置（有值时优先看它）。
 * @returns {object} 本帧结果 { x, y, facing, gazeX, gazeY, eyesClosed, mood }。
 */
export function stepPet(pet, dt, world) {
  const bounds = world.bounds
  const motion = MOTION[pet.mood] ?? MOTION[MOOD.IDLE]
  const random = pet.random

  // 休眠时不乱走，只做极小幅呼吸式漂移。
  const speed = motion.speed

  // 到点重新挑方向（模拟「东张西望 / 换个地方」）。
  pet.repickIn -= dt
  if (pet.repickIn <= 0) {
    const [min, max] = motion.repick
    pet.repickIn = min + random() * (max - min)
    const angle = random() * Math.PI * 2
    pet.vx = Math.cos(angle) * speed
    pet.vy = Math.sin(angle) * speed * 0.55 // 纵向慢一些：更像贴地走而不是飞
    if (Math.abs(pet.vx) > 1) pet.facing = pet.vx < 0 ? -1 : 1
  }

  // 位移
  const prevX = pet.x
  const prevY = pet.y
  pet.x += pet.vx * dt
  pet.y += pet.vy * dt

  // 贴边反弹（屏幕边界当成墙）
  if (pet.x <= bounds.x) {
    pet.x = bounds.x
    pet.vx = Math.abs(pet.vx)
    pet.facing = 1
    pet.repickIn = Math.min(pet.repickIn, 0.2)
  } else if (pet.x >= bounds.x + bounds.width) {
    pet.x = bounds.x + bounds.width
    pet.vx = -Math.abs(pet.vx)
    pet.facing = -1
    pet.repickIn = Math.min(pet.repickIn, 0.2)
  }
  if (pet.y <= bounds.y) {
    pet.y = bounds.y
    pet.vy = Math.abs(pet.vy)
  } else if (pet.y >= bounds.y + bounds.height) {
    pet.y = bounds.y + bounds.height
    pet.vy = -Math.abs(pet.vy)
  }
  pet.distance += Math.hypot(pet.x - prevX, pet.y - prevY)

  // 眨眼
  pet.blinkIn -= dt
  if (pet.blinkIn <= 0) {
    const [min, max] = pet.mood === MOOD.DORMANT ? [3, 7] : [1.5, 5]
    pet.blinkIn = min + random() * (max - min)
    pet.eyesClosed = !pet.eyesClosed && pet.mood !== MOOD.DORMANT
  }
  // 休眠档：常闭眼（但保留偶尔睁一下的生气）
  if (pet.mood === MOOD.DORMANT) pet.eyesClosed = pet.blinkIn > 0.35

  // 视线：有鼠标就盯鼠标，否则朝行进方向 + 轻微游移
  if (world.lookAt) {
    const targetX = world.lookAt.x
    const targetY = world.lookAt.y
    const cx = pet.x + bounds.width / 2
    const cy = pet.y + bounds.height / 2
    pet.gazeX = clamp((targetX - cx) / 260, -1, 1)
    pet.gazeY = clamp((targetY - cy) / 260, -1, 1)
  } else {
    const drift = 0.25 * motion.bob
    pet.gazeX = clamp(pet.gazeX * 0.92 + pet.facing * drift + (random() - 0.5) * 0.08, -1, 1)
    pet.gazeY = clamp(pet.gazeY * 0.92 + (random() - 0.5) * 0.08, -1, 1)
  }

  return {
    x: pet.x,
    y: pet.y,
    facing: pet.facing,
    gazeX: pet.gazeX,
    gazeY: pet.gazeY,
    eyesClosed: pet.eyesClosed,
    mood: pet.mood,
  }
}

/**
 * 切换情绪（DSH 状态变化时调用），返回是否真的变了。
 * @param {object} pet 宠物实例。
 * @param {string} mood 新情绪。
 * @returns {boolean} 是否发生变化。
 */
export function setMood(pet, mood) {
  if (!mood || pet.mood === mood) return false
  pet.mood = mood
  const motion = MOTION[mood] ?? MOTION[MOOD.IDLE]
  // 情绪变化立刻改变速度量级，避免「切到 working 却还慢悠悠」
  const mag = Math.hypot(pet.vx, pet.vy)
  if (mag > 0.001) {
    const scale = motion.speed / mag
    pet.vx *= scale
    pet.vy *= scale
  }
  pet.repickIn = Math.min(pet.repickIn, 0.3)
  return true
}

/**
 * 把宠物瞬移到指定坐标（幽灵闪现 / 换显示器 / 用户拖拽后落点校正）。
 * @param {object} pet 宠物实例。
 * @param {number} x 目标 x。
 * @param {number} y 目标 y。
 * @param {{x:number,y:number,width:number,height:number}} bounds 允许范围。
 */
export function teleport(pet, x, y, bounds) {
  pet.x = clamp(x, bounds.x, bounds.x + bounds.width)
  pet.y = clamp(y, bounds.y, bounds.y + bounds.height)
  pet.vx = 0
  pet.vy = 0
  pet.repickIn = Math.min(pet.repickIn, 0.3)
}

/** 把 v 夹在 [lo, hi] 之间。 */
function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 把 DSH 状态映射成情绪。
 * @param {{connected?: boolean, running?: boolean, sessions?: number}} state DSH 状态快照。
 * @returns {string} MOOD 之一。
 */
export function moodFromState(state) {
  if (!state || state.connected !== true) return MOOD.DORMANT
  if (state.running === true) return MOOD.WORKING
  return MOOD.IDLE
}
