// 智子桌面宠物 · Electron 主进程
//
// 窗口架构（两个窗口，各司其职）：
//   1) overlay：**无边框 + 透明 + 置顶 + 鼠标穿透**，覆盖所有显示器的并集。
//      宠物的画面（眼睛/光晕/头顶进度）全部画在这里，因此可以自由跨越显示器边界。
//   2) hitbox：一个跟随宠物移动的**小窗口**，负责接收鼠标（点击/拖拽/右键菜单）。
//      它只在宠物那一小块区域存在，桌面其余地方点击照常穿透到下面的应用。
//
// 这样既做到「宠物在系统桌面上活动」，又不会挡住用户正常点别的东西。
// 行为计算（游荡/贴边/视线/情绪）在 ../core/behavior.mjs 里，本文件只负责把算出的
// x/y 应用到窗口、以及把鼠标事件翻译成宠物动作。

// 说明：Electron 44 的 main 进程**不提供** electron 的具名 ESM 导出
// （`import { BrowserWindow } from 'electron'` 会抛 SyntaxError），
// 因此主进程用 CJS（.cjs）。纯逻辑模块仍是 ESM（.mjs），用动态 import() 加载。

const { app, BrowserWindow, ipcMain, Menu, screen, Tray, nativeImage } = require('electron')
const { join } = require('node:path')
const { readFileSync, writeFileSync, appendFileSync } = require('node:fs')

/** 诊断日志：GUI 进程的 stdout 常常丢失，所以关键步骤写文件（同时尽力打 stdout）。 */
const DIAG = join(__dirname, '..', 'pet-diag.log')
function diag(message) {
  const line = `${new Date().toISOString()} ${message}\n`
  try {
    appendFileSync(DIAG, line, 'utf8')
  } catch {
    /* 诊断失败不能影响启动 */
  }
  try {
    process.stdout.write(line)
  } catch {
    /* stdout 不可用就算了 */
  }
}

/** 常驻模块级绑定：app ready 时从 ESM 核心模块载入后赋值。 */
let createPet = null
let stepPet = null
let setMood = null
let teleport = null
let MOOD = null
let createStateBridge = null
let progressText = null
let SKIN_ORDER = []
let skinLabel = (n) => n

const here = __dirname
const root = join(here, '..')

/** 宠物视觉尺寸（overlay 里眼睛的画布尺寸）。 */
const PET_SIZE = 200
/** 可点击区域尺寸（比视觉略小，避免误挡桌面）。 */
const HIT_SIZE = 96
/** 状态轮询间隔（毫秒）。 */
const POLL_MS = 1200

/** 持久化的小配置（皮肤/位置/置顶）。 */
const stateFile = () => join(app.getPath('userData'), 'pet-state.json')

function loadState() {
  try {
    const raw = JSON.parse(readFileSync(stateFile(), 'utf8'))
    return {
      skin: typeof raw.skin === 'string' ? raw.skin : 'sophon',
      x: Number.isFinite(raw.x) ? raw.x : undefined,
      y: Number.isFinite(raw.y) ? raw.y : undefined,
      alwaysOnTop: raw.alwaysOnTop !== false,
    }
  } catch {
    return { skin: 'sophon', x: undefined, y: undefined, alwaysOnTop: true }
  }
}

function saveState(patch) {
  try {
    const next = { ...saved, ...patch }
    saved = next
    writeFileSync(stateFile(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* 落盘失败不影响运行 */
  }
}

let saved = { skin: 'sophon', alwaysOnTop: true }
let overlays = [] // 每个显示器一个 overlay 窗口（跨 DPI 多屏无法用一个窗口覆盖）
let hitbox = null
let tray = null
let pet = null
let tickTimer = null
let cursorTimer = null
let bridge = null
let dragging = false
let dragOffset = { x: 0, y: 0 }
let lastFrame = 0
let currentMood = '' // 真实值在 core 模块载入后设置为 MOOD.IDLE
let latestState = { connected: false, running: false, title: '', todo: null, goal: null }

/**
 * 所有显示器工作区的并集 —— 宠物可在整块桌面（含多屏）里活动。
 * 用并集而不是单屏，是为了让跨屏移动不出现「到边界就卡住」的割裂感。
 * @returns {{x:number,y:number,width:number,height:number}} 桌面矩形（窗口左上角可达范围）。
 */
function desktopBounds() {
  const displays = screen.getAllDisplays()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const display of displays) {
    const area = display.workArea ?? display.bounds
    minX = Math.min(minX, area.x)
    minY = Math.min(minY, area.y)
    maxX = Math.max(maxX, area.x + area.width)
    maxY = Math.max(maxY, area.y + area.height)
  }
  if (!Number.isFinite(minX)) {
    const primary = screen.getPrimaryDisplay().workArea
    minX = primary.x
    minY = primary.y
    maxX = primary.x + primary.width
    maxY = primary.y + primary.height
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX - PET_SIZE),
    height: Math.max(0, maxY - minY - PET_SIZE),
  }
}

/** 鼠标在 DIP 坐标下的位置（用于「眼睛跟随鼠标」）。 */
function cursorPoint() {
  try {
    const point = screen.getCursorScreenPoint()
    return { x: point.x, y: point.y }
  } catch {
    return null
  }
}

function createWindows() {
  // 每个显示器一个 overlay。
  // 为什么不是「一个窗口覆盖所有屏」：实测跨不同 DPI 的多屏时 Electron 会把窗口压回单屏尺寸
  // （本机 2560×1440@1.5 + 1080×1921@2，请求 3640×1921 实际得到 2560×1392），
  // 于是宠物一走到第二块屏就没了。每屏一个窗口 + 渲染层自己决定画不画，才真正跨屏可用。
  overlays = screen.getAllDisplays().map((display) => {
    const area = display.bounds
    const window = new BrowserWindow({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      acceptFirstMouse: true,
      alwaysOnTop: saved.alwaysOnTop,
      webPreferences: {
        preload: join(here, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    window.setIgnoreMouseEvents(true, { forward: true })
    window.setAlwaysOnTop(saved.alwaysOnTop, 'screen-saver')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.webContents.on('did-finish-load', () => diag(`overlay did-finish-load display=${display.id}`))
    window.webContents.on('did-fail-load', (_e, code, desc, url) => diag(`overlay did-fail-load ${code} ${desc} ${url}`))
    window.webContents.on('render-process-gone', (_e, details) => diag(`overlay render-process-gone ${JSON.stringify(details)}`))
    void window.loadFile(join(root, 'renderer', 'index.html'), { query: { mode: 'overlay' } })
    return { displayId: display.id, area, window }
  })

  // 装载完成后把显示器清单推给每个 overlay（渲染层据此把宠物画在正确的那块屏上）
  for (const item of overlays) {
    item.window.webContents.on('did-finish-load', () => {
      item.window.webContents.send('pet:displays', overlays.map((o) => ({ id: o.displayId, area: o.area })))
    })
  }

  const primary = screen.getPrimaryDisplay().workArea

  hitbox = new BrowserWindow({
    x: Math.round((pet?.x ?? primary.x) + (PET_SIZE - HIT_SIZE) / 2),
    y: Math.round((pet?.y ?? primary.y) + (PET_SIZE - HIT_SIZE) / 2),
    width: HIT_SIZE,
    height: HIT_SIZE,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: saved.alwaysOnTop,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  hitbox.setAlwaysOnTop(saved.alwaysOnTop, 'screen-saver')
  hitbox.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  hitbox.webContents.on('did-finish-load', () => diag('hitbox did-finish-load'))
  hitbox.webContents.on('did-fail-load', (_e, code, desc, url) => diag(`hitbox did-fail-load ${code} ${desc} ${url}`))
  void hitbox.loadFile(join(root, 'renderer', 'index.html'), { query: { mode: 'hitbox' } })

  diag(`windows created overlays=${overlays.length} hitbox=(${hitbox.getBounds().x},${hitbox.getBounds().y}) primary=(${primary.x},${primary.y},${primary.width},${primary.height})`)

  // 鼠标事件 → 主进程
  ipcMain.on('pet:drag-start', (_event, point) => {
    dragging = true
    const cursor = cursorPoint()
    if (cursor) dragOffset = { x: cursor.x - pet.x, y: cursor.y - pet.y }
    void point
  })
  ipcMain.on('pet:drag-move', () => {
    if (!dragging) return
    const cursor = cursorPoint()
    if (!cursor) return
    teleport(pet, cursor.x - dragOffset.x, cursor.y - dragOffset.y, desktopBounds())
    applyPosition()
  })
  ipcMain.on('pet:drag-end', () => {
    dragging = false
    saveState({ x: Math.round(pet.x), y: Math.round(pet.y) })
  })
  ipcMain.on('pet:click', () => {
    // 单击：休眠/唤醒切换（与窗口内插件的行为保持一致的心智模型）
    const next = currentMood === MOOD.DORMANT ? MOOD.IDLE : MOOD.DORMANT
    setMood(pet, next)
    currentMood = next
  })
  ipcMain.on('pet:context-menu', () => showPetMenu())
  ipcMain.on('pet:renderer-ready', (_event, mode) => diag(`renderer ready mode=${mode}`))
  ipcMain.on('pet:open-dsh', () => focusDshWindow())
  ipcMain.on('pet:hide', () => {
    for (const item of overlays) item.window.hide()
    hitbox?.hide()
  })
}

/**
 * 把宠物坐标同步到窗口。
 * 每块屏上的 overlay 各自收到「宠物在本屏坐标系里的相对位置」；
 * 不在本屏范围内的 overlay 收到 visible=false（渲染层直接不画，避免出现两个宠物）。
 */
function applyPosition() {
  if (!pet) return
  const frame = frameOfPet()
  for (const item of overlays) {
    const rel = { x: Math.round(pet.x - item.area.x), y: Math.round(pet.y - item.area.y) }
    const visible = rel.x > -PET_SIZE && rel.x < item.area.width && rel.y > -PET_SIZE && rel.y < item.area.height
    item.window.webContents.send('pet:frame', { rel, visible, area: item.area, frame })
  }
  hitbox?.setPosition(Math.round(pet.x + (PET_SIZE - HIT_SIZE) / 2), Math.round(pet.y + (PET_SIZE - HIT_SIZE) / 2))
}

/** 组装送给渲染层的一帧。 */
function frameOfPet() {
  const text = progressText(latestState)
  return {
    x: pet.x,
    y: pet.y,
    size: PET_SIZE,
    hitSize: HIT_SIZE,
    // hitbox 相对宠物左上角的内缩量：渲染层据此把可点光圈画在正确位置
    hitOffset: (PET_SIZE - HIT_SIZE) / 2,
    facing: pet.facing,
    gazeX: pet.gazeX,
    gazeY: pet.gazeY,
    eyesClosed: pet.eyesClosed,
    mood: pet.mood,
    skin: saved.skin,
    connected: latestState.connected === true,
    title: text,
  }
}

/** 主循环：推进行为 + 同步窗口。30fps 足够，省电。 */
function startLoop() {
  lastFrame = Date.now()
  tickTimer = setInterval(() => {
    const now = Date.now()
    const dt = Math.min(0.1, (now - lastFrame) / 1000)
    lastFrame = now
    if (!dragging) {
      stepPet(pet, dt, { bounds: desktopBounds(), lookAt: cursorPoint() })
      applyPosition()
    }
  }, 33)
}

/** 托盘：常驻入口，避免「关掉就找不回来」。 */
function createTray() {
  try {
    const icon = nativeImage.createFromPath(join(root, 'assets', 'tray.png'))
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
    tray.setToolTip('三体智子 · 桌面宠物')
    tray.setContextMenu(buildMenu())
  } catch {
    /* 托盘失败不影响宠物本体 */
  }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '打开 DSH 窗口', click: () => focusDshWindow() },
    { type: 'separator' },
    {
      label: '皮肤',
      submenu: SKIN_ORDER.map((name) => ({
        label: skinLabel(name),
        type: 'radio',
        checked: saved.skin === name,
        click: () => {
          saved.skin = name
          saveState({ skin: name })
          applyPosition()
          tray?.setContextMenu(buildMenu())
        },
      })),
    },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: saved.alwaysOnTop,
      click: (item) => {
        saved.alwaysOnTop = item.checked
        saveState({ alwaysOnTop: item.checked })
        for (const entry of overlays) entry.window.setAlwaysOnTop(item.checked, 'screen-saver')
        hitbox?.setAlwaysOnTop(item.checked, 'screen-saver')
      },
    },
    { label: '让它回屏幕中间', click: () => {
      const bounds = desktopBounds()
      teleport(pet, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds)
      applyPosition()
    } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ])
}

function showPetMenu() {
  const menu = buildMenu()
  menu.popup({ window: hitbox ?? undefined })
}

/** 把 DSH 主窗口拉到前台（双击宠物的效果）。 */
function focusDshWindow() {
  const ours = new Set([hitbox, ...overlays.map((item) => item.window)])
  for (const window of BrowserWindow.getAllWindows()) {
    if (ours.has(window)) continue
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    return true
  }
  return false
}

app.whenReady().then(async () => {
  // 先载入 ESM 纯逻辑模块并把函数绑定到模块级变量——**必须在使用之前**。
  // （早先的写法在导入前就调 loadState()，而它读的是尚未初始化的 saved，直接抛 TypeError。）
  const behavior = await import('../core/behavior.mjs')
  const bridgeApi = await import('../core/state-bridge.mjs')
  const skinApi = await import('../core/skins.mjs')
  createPet = behavior.createPet
  stepPet = behavior.stepPet
  setMood = behavior.setMood
  teleport = behavior.teleport
  MOOD = behavior.MOOD
  createStateBridge = bridgeApi.createStateBridge
  progressText = bridgeApi.progressText
  SKIN_ORDER = skinApi.SKIN_ORDER
  skinLabel = skinApi.skinLabel
  currentMood = MOOD.IDLE

  saved = loadState()
  diag(`ready electron=${process.versions.electron} smoke=${process.argv.includes('--smoke')}`)

  // ── 自检模式：不建窗口、不常驻，只把运行环境与关键计算打出来就退出 ──
  // 用途：在没有人盯着屏幕的情况下验证「依赖能加载、显示器能枚举、边界计算正确」。
  if (process.argv.includes('--smoke')) {
    const bounds = desktopBounds()
    const displays = screen.getAllDisplays().map((d) => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
    }))
    const probe = createPet({ x: bounds.x + 10, y: bounds.y + 10, mood: MOOD.WORKING })
    for (let i = 0; i < 300; i += 1) stepPet(probe, 1 / 30, { bounds })
    const report = {
      ok: true,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      userData: app.getPath('userData'),
      stateFile: stateFile(),
      displayCount: displays.length,
      displays,
      desktopBounds: bounds,
      probe: {
        x: Math.round(probe.x),
        y: Math.round(probe.y),
        distance: Math.round(probe.distance),
        insideBounds: probe.x >= bounds.x - 0.001
          && probe.x <= bounds.x + bounds.width + 0.001
          && probe.y >= bounds.y - 0.001
          && probe.y <= bounds.y + bounds.height + 0.001,
      },
      endpoint: 'http://127.0.0.1:19387/beast-tamer/api/state',
    }
    process.stdout.write(`PET_SMOKE ${JSON.stringify(report)}\n`)
    app.exit(0)
    return
  }

  const bounds = desktopBounds()
  pet = createPet({
    x: Number.isFinite(saved.x) ? saved.x : bounds.x + bounds.width / 2,
    y: Number.isFinite(saved.y) ? saved.y : bounds.y + bounds.height - 120,
    mood: MOOD.DORMANT,
  })
  createWindows()
  createTray()
  startLoop()

  // 鼠标位置单独高频采样：行为循环 30fps 对「眼睛跟手」略糊，视线另算。
  cursorTimer = setInterval(() => {
    if (dragging) return
    const cursor = cursorPoint()
    if (!cursor) return
    for (const item of overlays) {
      if (!item.window.isDestroyed()) item.window.webContents.send('pet:cursor', cursor)
    }
  }, 50)

  // DSH 状态桥：轮询三体 host 插件暴露的公开路由
  bridge = createStateBridge({
    intervalMs: POLL_MS,
    onState: (state) => {
      latestState = state
      const next = setMood(pet, state.connected ? (state.running ? MOOD.WORKING : MOOD.IDLE) : MOOD.DORMANT)
      if (next) currentMood = pet.mood
      applyPosition()
    },
  })
  bridge.start()

  // 显示器变化（插拔/改分辨率）时重算覆盖范围
  screen.on('display-metrics-changed', () => relayout())
  screen.on('display-added', () => relayout())
  screen.on('display-removed', () => relayout())
})

/** 显示器布局变化后重建覆盖区域，并把宠物夹回可用范围。 */
function relayout() {
  // 最稳的做法是重建 overlay 集合：显示器数量/分辨率/DPI 变化时，
  // 旧窗口的 bounds 与坐标系都不可信，改 bounds 容易留下错位的窗口。
  for (const item of overlays) {
    if (!item.window.isDestroyed()) item.window.destroy()
  }
  overlays = []
  createWindows()
  const bounds = desktopBounds()
  teleport(pet, pet.x, pet.y, bounds)
  applyPosition()
  diag(`relayout displays=${overlays.length} bounds=(${bounds.x},${bounds.y},${bounds.width},${bounds.height})`)
}

app.on('window-all-closed', () => {
  // 桌面宠物：窗口全关也不退出（由托盘控制生命周期）
})

app.on('before-quit', () => {
  if (tickTimer) clearInterval(tickTimer)
  if (cursorTimer) clearInterval(cursorTimer)
  bridge?.stop()
  saveState({ x: Math.round(pet?.x ?? 0), y: Math.round(pet?.y ?? 0) })
})
