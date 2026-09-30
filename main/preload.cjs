// preload：两个窗口共用。
// overlay（鼠标穿透）只接收主进程推来的帧数据；hitbox 只上报鼠标事件。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pet', {
  /** 监听主进程推送的一帧（仅 overlay 用）。 */
  onFrame(callback) {
    const handler = (_event, frame) => callback(frame)
    ipcRenderer.on('pet:frame', handler)
    return () => ipcRenderer.removeListener('pet:frame', handler)
  },
  /** 监听鼠标绝对坐标（仅 overlay 用，用于眼睛跟随）。 */
  onCursor(callback) {
    const handler = (_event, point) => callback(point)
    ipcRenderer.on('pet:cursor', handler)
    return () => ipcRenderer.removeListener('pet:cursor', handler)
  },
  /** 监听显示器布局变化。 */
  onResize(callback) {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('pet:resize', handler)
    return () => ipcRenderer.removeListener('pet:resize', handler)
  },

  // ── 以下仅 hitbox 用 ─────────────────────────────────────────────────
  dragStart(point) {
    ipcRenderer.send('pet:drag-start', point)
  },
  dragMove() {
    ipcRenderer.send('pet:drag-move')
  },
  dragEnd() {
    ipcRenderer.send('pet:drag-end')
  },
  click() {
    ipcRenderer.send('pet:click')
  },
  contextMenu() {
    ipcRenderer.send('pet:context-menu')
  },
  openDsh() {
    ipcRenderer.send('pet:open-dsh')
  },
  hide() {
    ipcRenderer.send('pet:hide')
  },
  /** 渲染层挂载完成回报（主进程写进诊断日志，便于无人值守验收）。 */
  ready(mode) {
    ipcRenderer.send('pet:renderer-ready', mode)
  },
})
