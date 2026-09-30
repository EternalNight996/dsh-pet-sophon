// 集成测试：真起一个本机 HTTP 服务，按三体插件的状态路由契约喂数据，
// 验证「HTTP → 归一化 → 情绪映射 → 行为参数」整条链路真的贯通。
//
// 这条测试的价值：单测容易各自通过、拼起来却不通（字段名不一致、端口写错、
// 快照形状假设错误）。这里用真实网络回环把接口钉死。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createStateBridge, progressText } from '../core/state-bridge.mjs'
import { createPet, stepPet, setMood, moodFromState, MOOD } from '../core/behavior.mjs'

/** 起一个按契约返回快照的临时服务。 */
async function serve(getBody) {
  const server = createServer((req, res) => {
    const body = JSON.stringify(getBody())
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    })
    res.end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}/beast-tamer/api/state`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test('端到端：DSH 运行中 → 宠物进入 working 且真的动起来', async () => {
  const state = {
    ok: true,
    connected: true,
    running: true,
    sessions: 1,
    sessionId: 's1',
    title: '做桌面宠物',
    todo: { total: 10, done: 4, current: '写渲染层' },
    goal: { rounds: 2, maxRounds: 40 },
  }
  const server = await serve(() => state)
  const pet = createPet({ x: 100, y: 100 })

  const bridge = createStateBridge({ endpoint: server.url, intervalMs: 999999 })
  const snapshot = await bridge.pollOnce()
  await server.close()

  // 1) 快照解析正确
  assert.equal(snapshot.connected, true)
  assert.equal(snapshot.running, true)
  assert.equal(snapshot.todo.done, 4)
  assert.equal(progressText(snapshot), '4/10 · 40% · 写渲染层')

  // 2) 情绪映射正确
  const mood = moodFromState(snapshot)
  assert.equal(mood, MOOD.WORKING)

  // 3) 行为层真的按 working 档跑起来
  setMood(pet, mood)
  assert.equal(pet.mood, MOOD.WORKING)
  const bounds = { x: 0, y: 0, width: 800, height: 600 }
  for (let i = 0; i < 300; i += 1) stepPet(pet, 1 / 30, { bounds })
  assert.ok(pet.distance > 50, `working 档应产生明显位移，实际 ${pet.distance}`)
  assert.ok(pet.x >= bounds.x && pet.x <= bounds.x + bounds.width, '不能跑出屏幕')
})

test('端到端：DSH 空闲 → idle；DSH 不在 → dormant 且闭眼', async () => {
  const idle = await serve(() => ({ connected: true, running: false, sessions: 1 }))
  const bridgeIdle = createStateBridge({ endpoint: idle.url, intervalMs: 999999 })
  const idleState = await bridgeIdle.pollOnce()
  await idle.close()
  assert.equal(moodFromState(idleState), MOOD.IDLE)

  // 指向一个确定没人监听的端口
  const bridgeOff = createStateBridge({
    endpoint: 'http://127.0.0.1:9/beast-tamer/api/state',
    intervalMs: 999999,
    timeoutMs: 400,
  })
  const offState = await bridgeOff.pollOnce()
  assert.equal(offState.connected, false)
  assert.equal(moodFromState(offState), MOOD.DORMANT)

  const pet = createPet({ x: 10, y: 10 })
  setMood(pet, moodFromState(offState))
  for (let i = 0; i < 120; i += 1) stepPet(pet, 1 / 30, { bounds: { x: 0, y: 0, width: 800, height: 600 } })
  assert.equal(pet.eyesClosed, true, 'DSH 不在时宠物应休眠闭眼')
})

test('端到端：运行中→空闲的翻转会被回调捕获（情绪跟着变）', async () => {
  let running = true
  const server = await serve(() => ({ connected: true, running, sessions: 1 }))
  const seen = []
  const bridge = createStateBridge({
    endpoint: server.url,
    intervalMs: 999999,
    onState: (snapshot) => seen.push(moodFromState(snapshot)),
  })

  await bridge.pollOnce()
  running = false
  await bridge.pollOnce()
  await server.close()

  assert.deepEqual(seen, [MOOD.WORKING, MOOD.IDLE])
})
