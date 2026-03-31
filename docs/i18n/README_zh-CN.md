# Argus Automation

<p align="center">
  <a href="../../README.md">English</a> | <b>中文</b> | <a href="README_ja.md">日本語</a> | <a href="README_fr.md">Français</a> | <a href="README_de.md">Deutsch</a>
</p>

<p align="center">
  <b>面向 AI Agent 的 SOTA 桌面自动化。</b><br/>
  兼容 <b>Claude Code</b>、<b>Codex</b> 和 <b>OpenClaw</b>。
</p>

---

> **Argus**（Ἄργος Πανόπτης）——希腊神话中百目巨人，永不合眼的全视守卫。我们以此命名，因为它通过截图看见你的整个桌面，并以外科手术般的精准度操控一切——正如神话中的守护者，注视着托付给他的所有事物。

市面上其他桌面自动化 MCP 都在从零搭建工具定义、安全模型和调度逻辑。Argus 直接复用了 Anthropic **6,300+ 行**产品级 Chicago MCP 代码——正是驱动 Claude Code 内置 macOS 桌面控制功能的同一套代码——仅将原生层替换为 Windows 等价实现。同样的 24 个工具，同样的三层安全模型，同样的 token 优化策略。

## 两种根本不同的设计哲学

所有其他 MCP 采用的都是**「给模型一把锤子」**的思路——提供截图、点击、打字这些原子工具，然后指望模型自己想办法。每一步都是：截图 → 看 → 判断 → 操作 → 循环。

Argus 的思路截然不同：**把桌面自动化建模为一个有状态、受治理的会话**——具备分层安全、token 预算管理和批量执行能力。两者的差距是巨大的。

### 对比一：工具设计——扁平原语 vs 分层架构

**CursorTouch（5,000 stars）的工具：**
```
Click, Type, Scroll, Move, Shortcut, Screenshot, App, Shell...
```
每个工具都是独立的原子操作，彼此之间没有上下文关联。模型在每一步都必须截图 → 看 → 判断 → 操作。

**Argus 的分层工具设计：**
```
会话层:       request_access, list_granted_applications
视觉层:       screenshot, zoom
精确操作层:   left_click, double_click, triple_click, right_click,
              middle_click, left_mouse_down, left_mouse_up
输入层:       type, key, hold_key
效率层:       computer_batch (N 个操作 → 1 次 API 调用)
导航层:       open_application, switch_display
状态查询层:   cursor_position, read_clipboard, write_clipboard
等待层:       wait
```

24 个顶层工具 + 16 种批量操作类型。分层设计的精髓在于：**让模型在正确的抽象层级上思考，而不是每次都从像素级重新开始。**

### 对比二：「能用 API 就不截图」——最被低估的设计原则

这是最被低估的设计要点。其他 MCP 逼迫模型**通过视觉感知所有信息**。Argus 的原则是：如果信息能通过结构化 API 获取，就绝不浪费视觉 token。截图留给真正需要视觉理解的场景。

| 任务 | 其他 MCP | Argus | 省了什么 |
|---|---|---|---|
| **知道有哪些应用** | 截图 → 模型识别任务栏 | `listInstalledApps()` → 结构化数据 | 1 次截图 + 1 次视觉推理 |
| **打开应用程序** | 截图 → 找到图标 → 点击 | `open_application("Excel")` → 直接 API 调用 | 2-3 次截图 + 多次点击 |
| **知道当前聚焦的应用** | 截图 → 模型识别标题栏 | `getFrontmostApp()` → 返回 bundleId | 1 次截图 + 推理 |
| **知道光标位置** | 截图 → 模型猜 | `cursor_position` → 精确坐标 | 1 次截图 |
| **读取剪贴板** | Ctrl+V 粘贴到记事本 → 截图 → 识别 | `read_clipboard` → 返回文本 | 多次操作 + 2 次截图 |
| **切换显示器** | 截图 → 发现是错的 → 反复尝试 | `switch_display("Dell U2720Q")` | 反复试错的循环 |
| **阅读小号文字** | 模型对着压缩后的截图眯眼辨认 | `zoom` → 高分辨率局部裁切 | 误点击的代价 |

每次避免截图可节省约 **1,500 个视觉 token** 和 **3-5 秒**延迟。

### 对比三：`computer_batch`——唯一的批量执行引擎

这是**所有竞品都不具备**的能力。差距有多大？看这个：

**其他 MCP 执行「点击输入框 → 输入文字 → 按回车」：**
```
Call 1: screenshot        → 模型收到图片 → 推理 → 下一步
Call 2: click(100, 200)   → 模型收到 OK   → 推理 → 下一步
Call 3: type("hello")     → 模型收到 OK   → 推理 → 下一步
Call 4: key("Return")     → 模型收到 OK   → 推理 → 下一步
Call 5: screenshot        → 模型确认结果

= 5 次 API 往返 × 3-8 秒 = 15-40 秒
```

**Argus 做同样的事：**
```
Call 1: screenshot
Call 2: computer_batch([
  { action: "left_click", coordinate: [100, 200] },
  { action: "type", text: "hello" },
  { action: "key", text: "Return" },
  { action: "screenshot" }
])

= 2 次 API 往返 = 6-16 秒
```

**延迟和 token 消耗减少 60%。** 而且批量执行中的每个操作仍然会进行前台应用安全检查——不是盲目执行。

### 对比四：安全模型——产品级 vs 形同虚设

| 安全维度 | CursorTouch（5k stars） | MCPControl（306 stars） | **Argus** |
|---|:---:|:---:|:---:|
| 应用级权限 | 无 | 无 | **三层（read/click/full）** |
| 前台应用校验 | 无（可以点击任意窗口） | 无 | **每次操作前检查** |
| 危险按键拦截 | 无 | 无 | **Alt+F4、Win+L、Ctrl+Alt+Del** |
| 点击目标校验 | 无 | 无 | **9×9 像素陈旧性检测** |
| 剪贴板隔离 | 无 | 无 | **对 click 层级应用进行暂存/恢复** |
| 应用黑名单 | 无 | 无 | **浏览器→只读、终端→仅点击** |

CursorTouch 的 README 原话就是 *"POTENTIALLY DANGEROUS"*。而 Argus 的安全模型**为商业产品而设计**——Anthropic 的 Cowork 和桌面应用都采用同样的架构。

### 正面交锋总览

| 能力 | **Argus** | CursorTouch<br/>（5k stars） | MCPControl<br/>（306 stars） | domdomegg<br/>（176 stars） | sbroenne<br/>（24 stars） |
|---|:---:|:---:|:---:|:---:|:---:|
| **批量执行** | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **Token 预算优化** | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **三层应用权限** | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **前台应用校验** | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **危险按键拦截** | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **结构化 API**（无需截图获取信息） | **支持** | 部分支持 | 部分支持 | 不支持 | 支持 |
| **Zoom**（高分辨率细节裁切） | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **多显示器切换** | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **与 Claude Code 内置工具 Schema 一致** | **是** | 否 | 否 | 接近 | 否 |
| **复用的 Anthropic 上游代码** | **6,300+ 行** | 0 | 0 | 0 | 0 |
| 工具数量 | 24 | 19 | 12 | 6 | 10 |
| 开发语言 | TypeScript | Python | TypeScript | TypeScript | C# |

---

## 快速开始

### 环境要求

- **Node.js** 18+
- **Windows 10/11**
- Visual Studio Build Tools（robotjs 编译所需）

### 安装

```bash
git clone https://github.com/storyweaver/argus-automation.git
cd argus-automation
npm install
npm run build
```

### 在 Claude Code 中配置

在项目的 `.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "argus": {
      "command": "node",
      "args": ["C:/path/to/argus-automation/dist/index.js"]
    }
  }
}
```

重启 Claude Code，你将看到 24 个以 `mcp__argus__` 为前缀的新工具。

### 测试

```bash
npm test          # 70 个测试（单元测试 + 集成测试）
npm run test:unit # 仅运行单元测试
```

---

## 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  上游层 — 来自 Anthropic Chicago MCP 的 6,300+ 行代码                │
│  （仅修改 1 行）                                                     │
│                                                                     │
│  toolCalls.ts（3,649 行）— 安全校验 + 工具调度                        │
│  mcpServer.ts — Server 工厂 + 会话绑定                               │
│  tools.ts — 24 个工具的 Schema 定义                                  │
│  types.ts — 完整的类型系统                                           │
│  keyBlocklist.ts — 危险按键拦截（win32 分支）                         │
│  pixelCompare.ts — 9×9 陈旧性检测                                   │
│  imageResize.ts — Token 预算算法                                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ ComputerExecutor 接口
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Windows 原生层 — 约 400 行新代码                                    │
│                                                                     │
│  screen.ts — node-screenshots + sharp（DXGI 屏幕捕获、JPEG、缩放）  │
│  input.ts  — robotjs（SendInput 鼠标/键盘）                         │
│  window.ts — koffi + Win32 API（窗口管理）                           │
│  clipboard.ts — PowerShell Get/Set-Clipboard                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 技术栈

每个库都是 macOS 版本所用组件的 Windows 等价物：

| 模块 | macOS（Chicago MCP） | Windows（Argus） | 职责 |
|---|---|---|---|
| 屏幕截图 | SCContentFilter | **node-screenshots**（DXGI） | 屏幕捕获 |
| 输入控制 | enigo（Rust） | **robotjs**（SendInput） | 鼠标和键盘 |
| 窗口管理 | Swift + NSWorkspace | **koffi** + Win32 API | 窗口控制 |
| 图像处理 | Sharp | **Sharp** | JPEG 压缩 + 缩放 |
| MCP 框架 | @modelcontextprotocol/sdk | **@modelcontextprotocol/sdk** | MCP 协议 |

## 24 个工具

| 类别 | 工具 |
|---|---|
| **会话** | `request_access`、`list_granted_applications` |
| **视觉** | `screenshot`、`zoom` |
| **鼠标点击** | `left_click`、`double_click`、`triple_click`、`right_click`、`middle_click` |
| **鼠标控制** | `mouse_move`、`left_click_drag`、`left_mouse_down`、`left_mouse_up`、`cursor_position` |
| **滚动** | `scroll` |
| **键盘** | `type`、`key`、`hold_key` |
| **剪贴板** | `read_clipboard`、`write_clipboard` |
| **应用/显示器** | `open_application`、`switch_display` |
| **批量 + 等待** | `computer_batch`、`wait` |

## 安全模型

三层按应用分配的权限体系——**目前唯一具备此级别访问控制的 MCP 服务器**：

| 层级 | 截图 | 点击 | 打字/粘贴 |
|---|:---:|:---:|:---:|
| **read**（浏览器、交易软件） | 允许 | 禁止 | 禁止 |
| **click**（终端、IDE） | 允许 | 仅左键 | 禁止 |
| **full**（其他应用） | 允许 | 允许 | 允许 |

此外还有：危险按键拦截、每次操作前的前台应用校验、会话级授权。

## 日志

所有工具调用记录在：
```
%LOCALAPPDATA%\argus-automation\logs\mcp-YYYY-MM-DD.log
```

## 已知限制

- **CJK 文字输入**：非 ASCII 文本请使用 `write_clipboard` + `key("ctrl+v")` 的方式
- **应用发现**：目前仅返回运行中的应用（注册表扫描功能计划中）
- **像素校验**：已禁用（异步 sharp 无法满足同步接口要求）
- **hideBeforeAction**：已禁用（最小化操作会中断 WebView2 子进程）

## 许可证

MIT

## 致谢

基于 Anthropic 的 Chicago MCP 架构构建，提取自 Claude Code v2.1.88。`src/upstream/` 中的上游代码归属 Anthropic；Windows 原生层及集成代码为原创实现。
