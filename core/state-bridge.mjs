// DSH 状态桥（纯逻辑、可单测）。
//
// 数据来源：dsh-ui-three-body host 插件注册的**无需认证**本机路由
//   GET http://127.0.0.1:<port>/beast-tamer/api/state
//
// 为什么不用 DSH 官方 /api/*：实测那些路由在未携带凭据时一律 401
// （`/api`、`/api/sessions`、`/api/health`、`/api/settings` 全部 401），
// 而第三方插件自己 register 的 prefix 路由是公开的
// （对照：`/memory-eternal/api/overview` 实测 200）。所以状态桥必须由插件侧提供。

/** 默认轮询端点（端口与 DSH 桌面端默认一致）。 */
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:19387/beast-tamer/api/state'

/** 连续失败多少次后判定为「DSH 不可用」。 */
const FAILURES_BEFORE_OFFLINE = 2

/**
 * 创建一个状态桥。
 * @param {object} [options] 可选项。
 * @param {string} [options.endpoint] 状态路由地址。
 * @param {number} [options.intervalMs] 轮询间隔（毫秒）。
 * @param {number} [options.timeoutMs] 单次请求超时。
 * @param {typeof fetch} [options.fetchImpl] 注入的 fetch（便于测试）。
 * @param {(state: object) => void} [options.onState] 状态变化回调。
 * @returns {object} 桥实例，含 start/stop/current。
 */
export function createStateBridge(options = {}) {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const intervalMs = options.intervalMs ?? 1200
  const timeoutMs = options.timeoutMs ?? 900
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const onState = options.onState

  let timer = null
  let stopped = true
  let failures = 0
  let last = {
    connected: false,
    running: false,
    sessions: 0,
    title: '',
    goal: null,
    todo: null,
    updatedAt: 0,
  }

  /** 把任意异常归一成「离线」状态，绝不让轮询抛到调用方。 */
  function offline(reason) {
    failures += 1
    if (failures >= FAILURES_BEFORE_OFFLINE && last.connected) {
      last = { ...last, connected: false, running: false, updatedAt: Date.now() }
      onState?.(last)
    } else if (!last.connected) {
      last = { ...last, connected: false, updatedAt: Date.now() }
    }
    void reason
  }

  /** 拉一次。 */
  async function pollOnce() {
    if (typeof fetchImpl !== 'function') return last
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timerId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
      let response
      try {
        response = await fetchImpl(endpoint, controller ? { signal: controller.signal } : undefined)
      } finally {
        if (timerId) clearTimeout(timerId)
      }
      if (!response || !response.ok) {
        offline(`http ${response ? response.status : 'no-response'}`)
        return last
      }
      const body = await response.json()
      failures = 0
      const next = normalizeState(body)
      const changed =
        next.connected !== last.connected
        || next.running !== last.running
        || next.sessions !== last.sessions
        || next.title !== last.title
        || JSON.stringify(next.todo) !== JSON.stringify(last.todo)
        || JSON.stringify(next.goal) !== JSON.stringify(last.goal)
      last = next
      if (changed) onState?.(next)
    } catch (error) {
      offline(error)
    }
    return last
  }

  return {
    /** 当前快照。 */
    current: () => last,
    /** 立即拉一次（不启动轮询）。 */
    pollOnce,
    /** 启动轮询。 */
    start() {
      if (!stopped) return
      stopped = false
      void pollOnce()
      timer = setInterval(() => {
        void pollOnce()
      }, intervalMs)
      if (typeof timer.unref === 'function') timer.unref()
    },
    /** 停止轮询。 */
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}

/**
 * 把插件返回的原始 JSON 归一成宠物要用的形状（对缺字段/脏数据免疫）。
 * @param {unknown} body 路由返回体。
 * @returns {object} 归一化状态。
 */
export function normalizeState(body) {
  const raw = body && typeof body === 'object' ? body : {}
  const todo = raw.todo && typeof raw.todo === 'object'
    ? {
      total: numberOr(raw.todo.total, 0),
      done: numberOr(raw.todo.done, 0),
      current: typeof raw.todo.current === 'string' ? raw.todo.current.slice(0, 60) : '',
    }
    : null
  const goal = raw.goal && typeof raw.goal === 'object'
    ? {
      rounds: numberOr(raw.goal.rounds, 0),
      maxRounds: numberOr(raw.goal.maxRounds, 0),
    }
    : null
  return {
    connected: raw.connected !== false,
    running: raw.running === true,
    sessions: numberOr(raw.sessions, 0),
    title: typeof raw.title === 'string' ? raw.title.slice(0, 40) : '',
    goal,
    todo,
    updatedAt: Date.now(),
  }
}

/** 宽松取数：非有限数一律回落到兜底值。 */
function numberOr(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 生成「头顶进度」文本：优先待办，其次目标轮次，最后标题。
 * @param {object} state 归一化状态。
 * @returns {string} 单行短文本（可为空串）。
 */
export function progressText(state) {
  if (!state || state.connected !== true) return ''
  const todo = state.todo
  if (todo && todo.total > 0) {
    const pct = Math.round((todo.done / todo.total) * 100)
    return `${todo.done}/${todo.total} · ${pct}%${todo.current ? ` · ${todo.current}` : ''}`
  }
  const goal = state.goal
  if (goal && goal.maxRounds > 0) return `轮次 ${goal.rounds}/${goal.maxRounds}`
  return state.title ?? ''
}
