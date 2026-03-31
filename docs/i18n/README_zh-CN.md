# Windows Computer Use MCP

<p align="center">
  <a href="../../README.md">English</a> | <b>中文</b> | <a href="README_ja.md">日本語</a> | <a href="README_fr.md">Français</a> | <a href="README_de.md">Deutsch</a>
</p>

**唯一基于 Anthropic 官方 Chicago MCP 架构构建的 Windows 桌面自动化 MCP 服务器。**

同样的 24 个工具，同样的三层安全模型，同样的 token 优化策略。只是将原生层替换为 Windows 实现。

市面上其他桌面自动化 MCP 都是从零开始构建工具定义、安全模型和调度逻辑。本项目直接复用了 Anthropic **6,300+ 行**产品级代码——与 Claude Code 内置 macOS 桌面控制功能完全相同的代码——仅将原生层（截图、输入、窗口管理）替换为 Windows 等价实现。

---

## 为什么这个架构与众不同

大多数桌面自动化 MCP 只给模型几个基础工具（截图、点击、打字），然后就听天由命了。**Chicago MCP**——Anthropic 的内部桌面控制架构——采用了截然不同的思路：它将桌面自动化视为一个**有状态、受治理的会话**，具备分层安全、token 预算管理和批量执行能力。

我们将这套架构移植到了 Windows。以下是具体差异：

### 架构对比

```
┌─────────────────────────────────────────────────────────────────────┐
│              其他 MCP 服务器                                         │
│                                                                     │
│   screenshot() ──→ 模型观察 ──→ click(x,y) ──→ 循环                │
│                                                                     │
│   没有安全机制。没有批量执行。没有 token 预算。没有状态管理。            │
│   模型每次都必须从头视觉解析所有内容。                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│              本项目（Chicago MCP 架构）                               │
│                                                                     │
│   ┌──── 会话层 ──────────────────────────────────────────────┐      │
│   │  request_access → 三层权限控制（read/click/full）          │      │
│   │  按应用授权、按键黑名单、前台应用校验                       │      │
│   └───────────────────────────────────────────────────────────┘      │
│   ┌──── 效率层 ──────────────────────────────────────────────┐      │
│   │  computer_batch: N 个操作 → 1 次 API 调用                 │      │
│   │  结构化 API: cursor_position、read_clipboard、             │      │
│   │    open_application — 无需截图                             │      │
│   │  targetImageSize: 二分搜索压缩至 ≤1568 token 预算          │      │
│   └───────────────────────────────────────────────────────────┘      │
│   ┌──── 视觉层（仅在真正需要时使用）─────────────────────────┐      │
│   │  screenshot → 模型观察 UI → click/type/scroll              │      │
│   │  zoom → 对小号文字进行高分辨率裁切                          │      │
│   └───────────────────────────────────────────────────────────┘      │
│   ┌──── 原生层（Windows）────────────────────────────────────┐      │
│   │  node-screenshots (DXGI) │ robotjs (SendInput)            │      │
│   │  koffi + Win32 API       │ sharp (JPEG/resize)            │      │
│   └───────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

### 正面对比：功能一览

| 能力 | **本项目** | CursorTouch<br/>Windows-MCP<br/>(5k stars) | MCPControl<br/>(306 stars) | domdomegg<br/>computer-use-mcp<br/>(176 stars) | sbroenne<br/>mcp-windows<br/>(24 stars) |
|---|:---:|:---:|:---:|:---:|:---:|
| **批量执行**（N 个操作合并为 1 次 API 调用） | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **Token 预算优化**（二分搜索压缩至 ≤1568 tokens） | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **三层应用权限**（read / click / full） | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **前台应用校验**（非目标应用聚焦时阻止操作） | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **危险按键拦截**（Alt+F4、Win+L、Ctrl+Alt+Del） | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **结构化 API**（无需截图即可获取信息） | **支持** | 部分支持 | 部分支持 | 不支持 | 支持 |
| **Zoom**（高分辨率裁切查看细节） | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **多显示器**（按显示器名称切换） | **支持** | 不支持 | 不支持 | 不支持 | 不支持 |
| **与 Claude Code 内置工具相同的 Schema** | **是** | 否 | 否 | 接近 | 否 |
| **复用的 Anthropic 上游代码** | **6,300+ 行** | 0 | 0 | 0 | 0 |
| 工具数量 | 24 | 19 | 12 | 6 | 10 |
| 开发语言 | TypeScript | Python | TypeScript | TypeScript | C# |

### 批量执行为什么重要

没有 `computer_batch` 时，一个"点击-输入-回车"序列需要 **5 次 API 往返**（每次 3-8 秒）。有了它：

```javascript
// 5 次往返 → 2 次。延迟和 token 消耗减少 60%。
computer_batch([
  { action: "left_click", coordinate: [100, 200] },
  { action: "type", text: "hello world" },
  { action: "key", text: "Return" },
  { action: "screenshot" }
])
```

目前没有任何其他 Windows MCP 服务器支持此功能。

### "能用 API 就不截图"为什么重要

其他 MCP 强迫模型**对所有信息都进行截图和视觉解析**。Chicago MCP 的理念是：如果信息能通过 API 获取，就不浪费视觉 token。

| 任务 | 其他 MCP | 本项目 |
|---|---|---|
| 当前聚焦的是哪个应用？ | 截图 → 模型识别标题栏 | `getFrontmostApp()` → 结构化数据 |
| 光标在哪里？ | 截图 → 模型猜测 | `cursor_position` → 精确的 `{x, y}` |
| 读取剪贴板 | Ctrl+V 粘贴到记事本 → 截图 → 识别 | `read_clipboard` → 文本字符串 |
| 打开应用程序 | 截图 → 找到图标 → 点击 | `open_application("Excel")` → API 调用 |
| 切换显示器 | 截图 → 发现是错误的显示器 → 重试 | `switch_display("Dell U2720Q")` |

每次避免截图可节省约 **1,500 个视觉 token** 和 **3-5 秒**延迟。

---

## 快速开始

### 环境要求

- **Node.js** 18+
- **Windows 10/11**
- Visual Studio Build Tools（robotjs 编译所需）

### 安装

```bash
git clone https://github.com/storyweaver/windows-computer-use-mcp.git
cd windows-computer-use-mcp
npm install
npm run build
```

### 在 Claude Code 中配置

在项目的 `.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "windows-computer-use": {
      "command": "node",
      "args": ["C:/path/to/windows-computer-use-mcp/dist/index.js"]
    }
  }
}
```

重启 Claude Code，你将看到 24 个以 `mcp__windows-computer-use__` 为前缀的新工具。

### 测试

```bash
npm test          # 70 个测试（单元测试 + 集成测试）
npm run test:unit # 仅运行单元测试
```

---

## 项目结构

```
src/
├── upstream/              # 来自 @ant/computer-use-mcp 的 6,300+ 行代码（仅修改 1 行）
│   ├── toolCalls.ts       # 3,649 行：安全校验 + 工具调度
│   ├── tools.ts           # 24 个工具的 Schema 定义
│   ├── mcpServer.ts       # MCP Server 工厂 + 会话绑定
│   ├── types.ts           # 完整的类型系统
│   ├── executor.ts        # ComputerExecutor 接口（重建）
│   ├── keyBlocklist.ts    # 危险按键拦截（内置 win32 分支）
│   ├── pixelCompare.ts    # 9×9 像素变化检测
│   ├── imageResize.ts     # Token 预算算法
│   └── ...                # deniedApps、sentinelApps、subGates
├── native/                # Windows 原生层（约 400 行）
│   ├── screen.ts          # node-screenshots + sharp（DXGI 屏幕捕获）
│   ├── input.ts           # robotjs（SendInput 鼠标/键盘）
│   ├── window.ts          # koffi + Win32 API（窗口管理）
│   └── clipboard.ts       # PowerShell Get/Set-Clipboard
├── executor-windows.ts    # ComputerExecutor 实现
├── host-adapter.ts        # HostAdapter 组装
├── logger.ts              # 基于文件的日志系统
└── index.ts               # stdio MCP Server 入口点
```

## 技术栈

每个库都是 Chicago MCP 在 macOS 上所用组件的 Windows 等价物：

| 模块 | macOS（Chicago MCP） | Windows（本项目） | 职责 |
|---|---|---|---|
| 屏幕截图 | SCContentFilter | **node-screenshots** (DXGI) | 屏幕捕获 |
| 输入控制 | enigo (Rust) | **robotjs** (SendInput) | 鼠标和键盘 |
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

三层按应用分配的权限体系——目前唯一具备此能力的 MCP 服务器：

| 层级 | 截图 | 点击 | 打字/粘贴 |
|---|:---:|:---:|:---:|
| **read**（浏览器、交易软件） | 允许 | 禁止 | 禁止 |
| **click**（终端、IDE） | 允许 | 仅左键 | 禁止 |
| **full**（其他应用） | 允许 | 允许 | 允许 |

此外还有：危险按键拦截、前台应用校验、会话级授权。

## 日志

```
%LOCALAPPDATA%\windows-computer-use-mcp\logs\mcp-YYYY-MM-DD.log
```

## 已知限制

- **CJK 文字输入**：非 ASCII 文本请使用 `write_clipboard` + `key("ctrl+v")` 的方式
- **应用发现**：目前仅返回运行中的应用（注册表扫描功能计划中）
- **像素校验**：已禁用（异步 sharp 无法满足同步接口要求）
- **hideBeforeAction**：已禁用（最小化操作会中断 WebView2 子进程）

## 许可证

MIT

## 致谢

基于 Anthropic 的 `@ant/computer-use-mcp`（Chicago MCP）构建，提取自 Claude Code v2.1.88。`src/upstream/` 中的上游代码归属 Anthropic；Windows 原生层为原创实现。
