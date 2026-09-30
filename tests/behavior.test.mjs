// 智子行为核心的确定性单测（无 Electron、无 DOM）。
//
// 重点验证三件容易出错的事：
//   1) 宠物**永远不会**跑出显示器边界（桌面宠物最刺眼的 bug 就是走出屏幕不见了）；
//   2) 情绪切换真的改变运动量级（否则「工作中」看起来和「休眠」一样）；
//   3) DSH 状态到情绪的映射符合预期。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPet,
  stepPet,
  setMood,
  teleport,
  moodFromState,
  MOOD,
} from '../core/behavior.mjs'

const BOUNDS = { x: 0, y: 0, width: 1000, height: 600 }

/** 确定性随机源：固定序列，避免测试随机翻车。 */
function seeded(values) {
  let i = 0
  return () => {
    const v = values[i % values.length]
    i += 1
    return v
  }
}

/** 跑 n 帧，每帧 dt 秒。 */
function run(pet, frames, dt, world = { bounds: BOUNDS }) {
  let out = null
  for (let i = 0; i < frames; i += 1) out = stepPet(pet, dt, world)
  return out
}

test('宠物在长时间游荡后始终留在显示器边界内', () => {
  const pet = createPet({ x: 500, y: 300, random: seeded([0.1, 0.9, 0.42, 0.77, 0.05, 0.63]) })
  run(pet, 4000, 1 / 30)
  assert.ok(pet.x >= BOUNDS.x - 0.001, `x 溢出左边界: ${pet.x}`)
  assert.ok(pet.x <= BOUNDS.x + BOUNDS.width + 0.001, `x 溢出右边界: ${pet.x}`)
  assert.ok(pet.y >= BOUNDS.y - 0.001, `y 溢出上边界: ${pet.y}`)
  assert.ok(pet.y <= BOUNDS.y + BOUNDS.height + 0.001, `y 溢出下边界: ${pet.y}`)
})

test('碰到边界会反弹，而不是卡住或穿墙', () => {
  const pet = createPet({ x: 999, y: 300, random: seeded([0.5]) })
  // 强行给出朝右的速度
  pet.vx = 200
  pet.vy = 0
  stepPet(pet, 0.1, { bounds: BOUNDS })
  assert.ok(pet.x <= BOUNDS.x + BOUNDS.width, '不应越过右边界')
  assert.ok(pet.vx < 0, '碰右墙后水平速度应反向')

  pet.x = 0
  pet.vx = -200
  stepPet(pet, 0.1, { bounds: BOUNDS })
  assert.ok(pet.x >= BOUNDS.x, '不应越过左边界')
  assert.ok(pet.vx > 0, '碰左墙后水平速度应反向')
})

test('边界反弹会立刻改写朝向，保证眼珠朝运动方向', () => {
  const pet = createPet({ x: 999, y: 300, random: seeded([0.5]) })
  pet.vx = 200
  pet.facing = 1
  const out = stepPet(pet, 0.1, { bounds: BOUNDS })
  assert.equal(out.facing, -1)
})

test('确实在移动：一段时间后累计位移明显大于 0', () => {
  const pet = createPet({ x: 500, y: 300, mood: MOOD.WORKING, random: seeded([0.3, 0.8, 0.15, 0.55]) })
  run(pet, 600, 1 / 30)
  assert.ok(pet.distance > 50, `位移过小（可能没动）: ${pet.distance}`)
})

test('情绪切换改变运动量级：working 明显快于 dormant', () => {
  const mk = (mood) => createPet({ x: 500, y: 300, mood, random: seeded([0.25, 0.75, 0.5, 0.1]) })
  const working = mk(MOOD.WORKING)
  const dormant = mk(MOOD.DORMANT)
  run(working, 600, 1 / 30)
  run(dormant, 600, 1 / 30)
  assert.ok(
    working.distance > dormant.distance * 3,
    `working(${working.distance.toFixed(1)}) 应远大于 dormant(${dormant.distance.toFixed(1)})`,
  )
})

test('setMood 返回是否变化，并把速度缩放到新量级', () => {
  const pet = createPet({ x: 500, y: 300, mood: MOOD.IDLE, random: seeded([0.5]) })
  pet.vx = 10
  pet.vy = 0
  assert.equal(setMood(pet, MOOD.IDLE), false, '同一情绪应返回 false')
  assert.equal(setMood(pet, MOOD.WORKING), true)
  assert.ok(Math.abs(Math.hypot(pet.vx, pet.vy) - 64) < 1, '速度量级应被提到 working 档')
})

test('休眠档常闭眼，待命/工作档会睁眼', () => {
  const dormant = createPet({ x: 500, y: 300, mood: MOOD.DORMANT, random: seeded([0.5]) })
  run(dormant, 200, 1 / 30)
  assert.equal(dormant.eyesClosed, true, '休眠应闭眼')

  const idle = createPet({ x: 500, y: 300, mood: MOOD.IDLE, random: seeded([0.9]) })
  const out = run(idle, 5, 1 / 30)
  assert.equal(out.eyesClosed, false, '待命不该一直闭眼')
})

test('有鼠标位置时视线跟着鼠标（归一化到 -1..1）', () => {
  const pet = createPet({ x: 500, y: 300, random: seeded([0.5]) })
  const out = stepPet(pet, 1 / 30, { bounds: BOUNDS, lookAt: { x: 5000, y: 5000 } })
  assert.ok(out.gazeX > 0.9, `鼠标在右下方，gazeX 应接近 1，实际 ${out.gazeX}`)
  assert.ok(out.gazeY > 0.9, `gazeY 应接近 1，实际 ${out.gazeY}`)
  const out2 = stepPet(pet, 1 / 30, { bounds: BOUNDS, lookAt: { x: -5000, y: -5000 } })
  assert.ok(out2.gazeX < -0.9, '鼠标在左上方，gazeX 应接近 -1')
})

test('teleport 会把宠物夹进边界并清零速度', () => {
  const pet = createPet({ x: 0, y: 0 })
  pet.vx = 100
  pet.vy = 100
  teleport(pet, 99999, -99999, BOUNDS)
  assert.equal(pet.x, BOUNDS.x + BOUNDS.width)
  assert.equal(pet.y, BOUNDS.y)
  assert.equal(pet.vx, 0)
  assert.equal(pet.vy, 0)
})

test('DT 异常（0 / NaN 尺寸）不会把坐标污染的成 NaN', () => {
  const pet = createPet({ x: 100, y: 100, random: seeded([0.5]) })
  stepPet(pet, 0, { bounds: BOUNDS })
  assert.ok(Number.isFinite(pet.x) && Number.isFinite(pet.y))
  const hostile = { x: NaN, y: NaN, width: 100, height: 100 }
  stepPet(pet, 1 / 30, { bounds: hostile })
  assert.ok(Number.isFinite(pet.x) || pet.x === hostile.x, '不允许产生 NaN 坐标')
})

test('moodFromState：未连接→休眠，连接但空闲→待命，运行中→工作', () => {
  assert.equal(moodFromState(undefined), MOOD.DORMANT)
  assert.equal(moodFromState({ connected: false }), MOOD.DORMANT)
  assert.equal(moodFromState({ connected: true, running: false }), MOOD.IDLE)
  assert.equal(moodFromState({ connected: true, running: true }), MOOD.WORKING)
})
