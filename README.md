# 三体智子 · 桌面宠物（dsh-pet-sophon）

把 DSH 里的悬浮智子**放出来**：一个无边框透明置顶窗口，让它在 **Windows 系统桌面**上自由游荡、
东张西望、贴边反弹，并**实时反映 DSH 会话状态**（空闲/工作中/离线 → 情绪与移动节奏）。

> 参考形态：Codex 桌面版宠物（桌面常驻、自主活动、点击交互）。
> 本项目的定位是 **DSH 的同伴进程**——不改 DSH 源码、随 DSH 升级不失效。

---

## 为什么是独立应用，而不是改造 DSH 桌面壳

| 方案 | 结论 |
|---|---|
| 插件直接开系统窗口 | ❌ 插件跑在 **Cordis host（Node 子进程）**，拿不到 Electron API |
| 改造官方桌面壳加窗口 | ⚠️ 可行但改的是别人维护的代码，**dsh 每次升级都可能被覆盖** |
| **独立 Electron 同伴应用（本项目）** | ✅ 不改 DSH、升级不失效、跨平台；代价是多一个常驻进程 |

DSH 官方的 `/api/*` 路由**需要凭据**（实测未授权一律 401），因此状态不能从官方接口读。
但第三方插件的 `webServer.register` 路由是**公开**的（对照：`/memory-eternal/api/overview` 实测 200），
所以状态桥由 `dsh-ui-three-body` 插件自己暴露一条只读路由。

---

## 运行

```bash
# 依赖：Electron（本机已装 33.4.11）
npm install

# 启动宠物
npm start

# 自检（不建窗口，打印运行环境/显示器/边界计算后退出）
node_modules/electron/dist/electron.exe . --smoke

# 纯逻辑测试（31 个用例，不需要 Electron）
npm test
```

> **注意**：若从 DSH 会话里启动，需要先清掉继承来的 `ELECTRON_RUN_AS_NODE=1`
> （那是 DSH 给子进程设的，会让 Electron 退化成纯 Node，窗口起不来）：
> ```powershell
> Remove-Item Env:\ELECTRON_RUN_AS_NODE
> npm start
> ```

---

## 交互

| 操作 | 行为 |
|---|---|
| 单击宠物 | 休眠 / 唤醒（休眠时移动极慢且闭眼） |
| 拖拽 | 把宠物拖到桌面任意位置（含另一块显示器） |
| 双击 | 把 DSH 主窗口拉到前台 |
| 右键 | 菜单：皮肤（11 款）、窗口置顶、回到屏幕中央、打开 DSH、退出 |
| 托盘图标 | 同样的菜单（关掉窗口也能找回来） |
| 鼠标移动 | 眼睛实时跟随鼠标 |

---

## 架构

```
main/main.cjs          Electron 主进程
                       · 每块显示器一个 overlay 窗口（无边框/透明/置顶/鼠标穿透）
                       · 一个跟随宠物的 hitbox 小窗口（接收点击/拖拽/右键）
                       · 30fps 行为循环：算坐标 → 推到渲染层
                       · 50ms 鼠标采样：让眼睛跟手
                       · 状态桥轮询 DSH

main/preload.cjs       contextBridge 暴露最小 API（渲染层不碰 Node）

renderer/index.html    两种模式共用一个页面（?mode=overlay|hitbox）
renderer/renderer.js   画眼睛、转瞳孔、合眼睑、显示头顶进度

core/behavior.mjs      纯逻辑：游荡/贴边/视线/情绪/瞬移（可单测）
core/skins.mjs         11 款皮肤数据（与 dsh-ui-three-body 同一套视觉 DNA）
core/eye-svg.mjs       眼睛 SVG 生成（纯字符串，可单测、可离线预览）
core/state-bridge.mjs  轮询 DSH 状态路由 + 归一化 + 失败降级

tools/make-icons.py            图标生成（托盘 + 应用）
tools/make-desk-preview.mjs    生成桌面效果预览页
tests/                         31 个用例：行为 / 状态桥 / SVG / 元数据 / 端到端
```

### 窗口架构为什么是「一屏一个 overlay」

实测：单窗口请求跨屏并集（3640×1921）时，Electron 会把它**压回单屏尺寸**（实际得到 2560×1392）——
本机两块屏 DPI 不同（2560×1440@1.5 + 1080×1921@2），跨 DPI 的窗口无法覆盖全部桌面。
所以改成**每块显示器一个透明 overlay**，渲染层按主进程给的 `visible` 决定画不画，
于是宠物可以真正跨越显示器边界，且不会出现「两只宠物」。

---

## 状态契约

`dsh-ui-three-body` 暴露 `GET /beast-tamer/api/state`（**无需认证、只读**），返回：

```json
{
  "ok": true,
  "connected": true,
  "running": true,
  "sessions": 2,
  "sessionId": "session-…",
  "title": "做桌面宠物",
  "goal":  { "objective": "…", "phase": "active", "rounds": 2, "maxRounds": 40 },
  "todo":  { "total": 10, "done": 4, "current": "写渲染层" }
}
```

宠物侧归一化后的映射：

| DSH 状态 | 情绪 | 表现 |
|---|---|---|
| `running: true` | `working` | 移动快、呼吸急促、瞳孔聚焦 |
| `connected` 但 `running: false` | `idle` | 慢速游荡、偶尔东张西望 |
| 路由不可达（DSH 未开/未装插件） | `dormant` | 几乎不动、闭眼 |

头顶进度优先显示 `todo`（`已完成/总数 · 百分比 · 当前步`），其次 `goal` 轮次，最后标题。

> 端口默认 `19387`（DSH 桌面端默认端口）。可用 `createStateBridge({ endpoint })` 覆盖。

---

## 已验证 / 未验证（诚实边界）

**已实测**：
- 真实 Electron 33.4.11 启动，双显示器（2560×1440 + 1080×1921）各起一个 overlay，
  hitbox 与两个 overlay 的渲染进程**全部上报 ready**，进程稳定常驻。
- 桌面并集边界计算正确：`(0,-430) 3440×1721`，宠物 300 帧游荡后仍在界内。
- 状态链路端到端：真起 HTTP 服务按契约喂数据 → 归一化 → 情绪 → 行为参数，全部贯通。
- 31 个用例全绿；11 款皮肤经 headless Chrome 截图**肉眼确认**画面正确
  （写轮眼勾玉 / 万花筒刃 / 轮回眼波纹 / 白眼 / 智子六边形等）。

**未实测（需要你实际用一次才能确认）**：
- **宠物在真实桌面上的观感**：透明度、置顶层级是否压过全屏应用、多屏拖拽的手感。
- **鼠标穿透**：overlay 用了 `setIgnoreMouseEvents(true)`，理论上桌面其余区域点击照常穿透；
  需确认宠物附近不会误挡点击。
- **托盘图标**在 Windows 通知区域的实际显示效果（`assets/tray.png` 是脚本生成的）。
- **与真实 DSH 的联通**：需要 `dsh-ui-three-body` 装在运行中的 profile 里并重启，
  本机当前会话继承 `ELECTRON_RUN_AS_NODE` 且桌面端未重启，未做这一步实测。

---

## 打包

`electron-builder` 未接入：本机 npm 访问 Electron 二进制源会被 TLS 证书拦截，
`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` + `NODE_OPTIONS=--use-system-ca` 可装上开发依赖，
但打 Windows 安装包还需补 electron-builder 配置。当前形态是**开发运行 + 托盘常驻**，
足够日常使用；要分发给别人再补打包。
