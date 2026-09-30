// 状态桥单测：DSH 在线/离线/脏数据/超时 都不允许把宠物搞崩。
//
// 事实依据（实测）：DSH 官方 /api/* 在未携带凭据时一律 401，
// 而第三方插件自注册的 prefix 路由是公开的（/memory-eternal/api/overview 实测 200）。
// 因此宿主插件必须自己暴露一条公开状态路由，桥只依赖那一条。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createStateBridge,
  normalizeState,
  progressText,
  DEFAULT_ENDPOINT,
} from '../core/state-bridge.mjs'

/** 固定返回某个 JSON 的假 fetch。 */
function fakeFetch(body, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, json: async () => body })
}

test('默认端点指向三体插件的公开状态路由', () => {
  assert.equal(DEFAULT_ENDPOINT, 'http://127.0.0.1:19387/beast-tamer/api/state')
})

test('正常响应：解析出 running/todo/title 并回调一次', async () => {
  const seen = []
  const bridge = createStateBridge({
    fetchImpl: fakeFetch({
      connected: true,
      running: true,
      sessions: 2,
      title: '实现桌面宠物',
      todo: { total: 8, done: 3, current: '写渲染层' },
      goal: { rounds: 1, maxRounds: 5 },
    }),
    onState: (state) => seen.push(state),
  })
  const state = await bridge.pollOnce()
  assert.equal(state.connected, true)
  assert.equal(state.running, true)
  assert.equal(state.todo.done, 3)
  assert.equal(state.title, '实现桌面宠物')
  assert.equal(seen.length, 1)
  assert.equal(progressText(state), '3/8 · 38% · 写渲染层')
})

test('状态没变时不重复回调（避免每次轮询都惊动渲染层）', async () => {
  const seen = []
  const bridge = createStateBridge({
    fetchImpl: fakeFetch({ connected: true, running: false, todo: { total: 2, done: 1 } }),
    onState: (state) => seen.push(state),
  })
  await bridge.pollOnce()
  await bridge.pollOnce()
  await bridge.pollOnce()
  assert.equal(seen.length, 1, '相同状态只应回调一次')
})

test('状态变化时回调（running 翻转）', async () => {
  let body = { connected: true, running: false }
  const seen = []
  const bridge = createStateBridge({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => body }),
    onState: (state) => seen.push(state),
  })
  await bridge.pollOnce()
  body = { connected: true, running: true }
  await bridge.pollOnce()
  assert.equal(seen.length, 2)
  assert.equal(seen[1].running, true)
})

test('HTTP 失败：连续两次后判定离线，且不抛错', async () => {
  const seen = []
  const bridge = createStateBridge({
    fetchImpl: fakeFetch(null, { ok: false, status: 401 }),
    onState: (state) => seen.push(state),
  })
  const first = await bridge.pollOnce()
  assert.equal(first.connected, false)
  const second = await bridge.pollOnce()
  assert.equal(second.connected, false)
  assert.ok(seen.every((s) => s.connected === false))
})

test('fetch 抛异常（DSH 没开）：退化为离线而不是崩溃', async () => {
  const bridge = createStateBridge({
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:19387')
    },
  })
  const state = await bridge.pollOnce()
  assert.equal(state.connected, false)
  assert.equal(state.running, false)
})

test('脏数据：字段乱给也不能污染快照', () => {
  const state = normalizeState({
    connected: 'yes',
    running: 'true',
    sessions: 'many',
    title: { evil: true },
    todo: { total: 'abc', done: null, current: 123 },
    goal: 'nope',
  })
  assert.equal(state.connected, true, "只有显式 false 才算离线")
  assert.equal(state.running, false, "只有严格 true 才算运行中")
  assert.equal(state.sessions, 0)
  assert.equal(state.title, '')
  assert.equal(state.todo.total, 0)
  assert.equal(state.todo.done, 0)
  assert.equal(state.todo.current, '')
  assert.equal(state.goal, null)
})

test('超长标题被截断（避免头顶标签撑爆）', () => {
  const state = normalizeState({ title: 'x'.repeat(200) })
  assert.equal(state.title.length, 40)
})

test('progressText：无待办时回落到目标轮次，再回落到标题', () => {
  assert.equal(progressText({ connected: true, todo: { total: 0, done: 0 }, goal: { rounds: 2, maxRounds: 9 }, title: 'T' }), '轮次 2/9')
  assert.equal(progressText({ connected: true, todo: null, goal: null, title: 'T' }), 'T')
  assert.equal(progressText({ connected: false, title: 'T' }), '')
  assert.equal(progressText(null), '')
})

test('start/stop 可重复调用不出错，且 stop 后不再轮询', async () => {
  let calls = 0
  const bridge = createStateBridge({
    intervalMs: 20,
    fetchImpl: async () => {
      calls += 1
      return { ok: true, status: 200, json: async () => ({ connected: true }) }
    },
  })
  bridge.start()
  bridge.start()
  await new Promise((resolve) => setTimeout(resolve, 60))
  bridge.stop()
  const afterStop = calls
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(calls, afterStop, 'stop 之后不应再发起请求')
  assert.ok(afterStop >= 1)
})
