# Windows Computer Use MCP

**The only Windows desktop automation MCP server built on Anthropic's official Chicago MCP architecture.**

Same 24 tools. Same 3-tier security model. Same token optimization. Just the native layer replaced for Windows.

Every other desktop-automation MCP builds its tool schemas, security model, and dispatch logic from scratch. This project directly reuses **6,300+ lines** of Anthropic's production code — the same code that powers Claude Code's built-in macOS desktop control — and replaces only the native layer (screenshot, input, window management) with Windows equivalents.

---

## Why This Architecture Is Different

Most desktop automation MCPs give the model a few primitive tools (screenshot, click, type) and hope for the best. **Chicago MCP** — Anthropic's internal architecture for desktop control — takes a fundamentally different approach: it treats desktop automation as a **stateful, governed session** with layered security, token budgeting, and batch execution.

We ported that architecture to Windows. Here's what that means in practice:

### Architecture Comparison

```
┌─────────────────────────────────────────────────────────────────────┐
│              Other MCP Servers                                      │
│                                                                     │
│   screenshot() ──→ model looks ──→ click(x,y) ──→ repeat           │
│                                                                     │
│   No security. No batching. No token budget. No state.              │
│   Model must visually parse EVERYTHING, every single time.          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│              This Project (Chicago MCP Architecture)                │
│                                                                     │
│   ┌──── Session Layer ────────────────────────────────────────┐     │
│   │  request_access → 3-tier permissions (read/click/full)    │     │
│   │  Per-app grants, key blocklist, frontmost gate            │     │
│   └───────────────────────────────────────────────────────────┘     │
│   ┌──── Efficiency Layer ─────────────────────────────────────┐     │
│   │  computer_batch: N actions → 1 API call                   │     │
│   │  Structured APIs: cursor_position, read_clipboard,        │     │
│   │    open_application — no screenshot needed                 │     │
│   │  targetImageSize: binary-search to ≤1568 token budget     │     │
│   └───────────────────────────────────────────────────────────┘     │
│   ┌──── Vision Layer (only when truly needed) ────────────────┐     │
│   │  screenshot → model sees UI → click/type/scroll           │     │
│   │  zoom → high-res crop for small text                      │     │
│   └───────────────────────────────────────────────────────────┘     │
│   ┌──── Native Layer (Windows) ───────────────────────────────┐     │
│   │  node-screenshots (DXGI) │ robotjs (SendInput)            │     │
│   │  koffi + Win32 API       │ sharp (JPEG/resize)            │     │
│   └───────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### Head-to-Head: Feature Comparison

| Capability | **This Project** | CursorTouch<br/>Windows-MCP<br/>(5k stars) | MCPControl<br/>(306 stars) | domdomegg<br/>computer-use-mcp<br/>(176 stars) | sbroenne<br/>mcp-windows<br/>(24 stars) |
|---|:---:|:---:|:---:|:---:|:---:|
| **Batch Execution** (N actions, 1 API call) | **Yes** | No | No | No | No |
| **Token Budget Optimization** (binary-search resize to ≤1568 tokens) | **Yes** | No | No | No | No |
| **3-Tier App Permissions** (read / click / full) | **Yes** | No | No | No | No |
| **Frontmost App Gate** (blocks action if wrong app is focused) | **Yes** | No | No | No | No |
| **Dangerous Key Blocking** (Alt+F4, Win+L, Ctrl+Alt+Del) | **Yes** | No | No | No | No |
| **Structured APIs** (cursor_position, clipboard, open_app without screenshots) | **Yes** | Partial | Partial | No | Yes |
| **Zoom** (high-res crop for fine detail) | **Yes** | No | No | No | No |
| **Multi-Display** (switch_display by monitor name) | **Yes** | No | No | No | No |
| **Same Tool Schema as Claude Code Built-in** | **Yes** | No | No | Close | No |
| **Upstream Anthropic Code Reused** | **6,300+ lines** | 0 | 0 | 0 | 0 |
| Tools Count | 24 | 19 | 12 | 6 | 10 |
| Language | TypeScript | Python | TypeScript | TypeScript | C# |
| Platform | Windows | Windows | Windows | Cross | Windows |

### Why Batch Execution Matters

Without `computer_batch`, clicking a field, typing text, and pressing Enter requires **5 API round-trips** (screenshot → click → type → key → screenshot), each taking 3-8 seconds. With batch execution:

```
// 5 round-trips → 2 round-trips. 60% less latency, 60% fewer tokens.
computer_batch([
  { action: "left_click", coordinate: [100, 200] },
  { action: "type", text: "hello world" },
  { action: "key", text: "Return" },
  { action: "screenshot" }
])
```

No other Windows MCP server supports this.

### Why "Use APIs When You Can" Matters

Other MCPs force the model to **screenshot and visually parse everything**. Chicago MCP's design principle: if information can be retrieved via a platform API, don't waste vision tokens on it.

| Task | Other MCPs | This Project |
|---|---|---|
| Which app is focused? | Screenshot → model reads title bar | `getFrontmostApp()` → structured data |
| Where is the cursor? | Screenshot → model guesses | `cursor_position` → exact `{x, y}` |
| Read clipboard | Ctrl+V into Notepad → screenshot → read | `read_clipboard` → text string |
| Open an application | Screenshot → find icon → click | `open_application("Excel")` → API call |
| Switch monitor | Screenshot → wrong monitor → trial and error | `switch_display("Dell U2720Q")` |

Each avoided screenshot saves **~1,500 vision tokens** and **3-5 seconds** of latency.

---

## Quick Start

### Prerequisites

- **Node.js** 18+ (with npm)
- **Windows 10/11**
- Visual Studio Build Tools (for robotjs native compilation)

### Install

```bash
git clone https://github.com/storyweaver/windows-computer-use-mcp.git
cd windows-computer-use-mcp
npm install
npm run build
```

### Configure in Claude Code

Add to your project's `.mcp.json`:

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

Restart Claude Code. You'll see 24 new tools prefixed with `mcp__windows-computer-use__`.

### Test

```bash
npm test          # 70 tests (unit + integration)
npm run test:unit # Unit tests only
```

---

## Project Structure

```
src/
├── upstream/              # 6,300+ lines from @ant/computer-use-mcp (1 line changed)
│   ├── toolCalls.ts       # 3,649 lines: security gates + tool dispatch
│   ├── tools.ts           # 24 tool schema definitions
│   ├── mcpServer.ts       # MCP Server factory + session binding
│   ├── types.ts           # Complete type system
│   ├── executor.ts        # ComputerExecutor interface (reconstructed)
│   ├── keyBlocklist.ts    # Dangerous key interception (win32 branch built-in)
│   ├── pixelCompare.ts    # 9×9 pixel staleness detection
│   ├── imageResize.ts     # Token budget algorithm
│   └── ...                # deniedApps, sentinelApps, subGates
├── native/                # Windows native layer (~400 lines)
│   ├── screen.ts          # node-screenshots + sharp (DXGI capture)
│   ├── input.ts           # robotjs (SendInput mouse/keyboard)
│   ├── window.ts          # koffi + Win32 API (window management)
│   └── clipboard.ts       # PowerShell Get/Set-Clipboard
├── executor-windows.ts    # ComputerExecutor implementation
├── host-adapter.ts        # HostAdapter assembly
├── logger.ts              # File-based logging
└── index.ts               # stdio MCP Server entry point

tests/
├── unit/                  # 51 unit tests
│   ├── screen.test.ts     # Screenshot, crop, JPEG validation
│   ├── window.test.ts     # Window enumeration, process queries
│   ├── input.test.ts      # Mouse movement, keyboard
│   ├── clipboard.test.ts  # Read/write, Unicode, multiline
│   └── upstream/          # keyBlocklist, imageResize (pure logic)
└── integration/           # 19 integration tests
    ├── executor.test.ts   # Full executor pipeline
    └── mcp-server.test.ts # MCP tool listing + tool calls
```

## Tech Stack

Aligned with Anthropic's own choices — each library is the Windows equivalent of what Chicago MCP uses on macOS:

| Module | macOS (Chicago MCP) | Windows (This Project) | Role |
|---|---|---|---|
| Screenshot | SCContentFilter | **node-screenshots** (DXGI) | Screen capture |
| Input | enigo (Rust) | **robotjs** (SendInput) | Mouse & keyboard |
| Window Mgmt | Swift + NSWorkspace | **koffi** + Win32 API | Window control |
| Image Processing | Sharp | **Sharp** | JPEG compress + resize |
| MCP Framework | @modelcontextprotocol/sdk | **@modelcontextprotocol/sdk** | MCP protocol |

## The 24 Tools

| Category | Tools |
|---|---|
| **Session** | `request_access`, `list_granted_applications` |
| **Vision** | `screenshot`, `zoom` |
| **Mouse Click** | `left_click`, `double_click`, `triple_click`, `right_click`, `middle_click` |
| **Mouse Control** | `mouse_move`, `left_click_drag`, `left_mouse_down`, `left_mouse_up`, `cursor_position` |
| **Scroll** | `scroll` |
| **Keyboard** | `type`, `key`, `hold_key` |
| **Clipboard** | `read_clipboard`, `write_clipboard` |
| **App/Display** | `open_application`, `switch_display` |
| **Batch + Wait** | `computer_batch`, `wait` |

## Security Model

Three-tier per-app permissions — the only MCP server with this level of access control:

| Tier | Can See in Screenshot | Can Click | Can Type/Paste |
|---|:---:|:---:|:---:|
| **read** (browsers, trading apps) | Yes | No | No |
| **click** (terminals, IDEs) | Yes | Yes (left-click only) | No |
| **full** (everything else) | Yes | Yes | Yes |

Plus: dangerous key blocking (Alt+F4, Win+L, Ctrl+Alt+Del), frontmost app gate on every action, and session-scoped grants.

## Logs

All MCP tool calls are logged to:
```
%LOCALAPPDATA%\windows-computer-use-mcp\logs\mcp-YYYY-MM-DD.log
```

## Known Limitations

- **Chinese/CJK text input**: `type` tool should use clipboard paste for non-ASCII text (workaround: use `write_clipboard` + `key("ctrl+v")`)
- **App discovery**: `listInstalledApps` currently returns running apps only (registry scan planned)
- **Pixel validation**: Disabled on Windows (sync `cropRawPatch` not feasible with sharp)
- **hideBeforeAction**: Disabled (Windows has no compositor-level window filtering; minimizing breaks WebView2 child processes)

## License

MIT

## Acknowledgements

This project is built on top of Anthropic's `@ant/computer-use-mcp` package (Chicago MCP), extracted from Claude Code v2.1.88. The upstream code in `src/upstream/` is Anthropic's work; the Windows native layer and integration code is original.

---

<div align="center">

**[English](#windows-computer-use-mcp)** | **[中文](#windows-computer-use-mcp-中文)**

</div>

---

# Windows Computer Use MCP (中文)

**全球唯一基于 Anthropic 官方 Chicago MCP 架构的 Windows 桌面控制 MCP Server。**

相同的 24 个工具。相同的三级安全模型。相同的 token 优化。只替换了原生层。

市面上所有其他桌面自动化 MCP 都从零开始设计工具 schema、安全模型和调度逻辑。本项目直接复用了 Anthropic **6,300+ 行**生产代码——驱动 Claude Code 内置 macOS 桌面控制的同一套代码——仅将原生层替换为 Windows 等价实现。

---

## 为什么这个架构完全不同

大多数桌面自动化 MCP 只是给模型几个原始工具（截图、点击、打字），然后祈祷模型自己搞定。**Chicago MCP** ——Anthropic 的内部桌面控制架构——采用了完全不同的方法：将桌面操作建模为一个**有状态的、分层治理的会话**，包含分级安全、token 预算控制和批量执行。

我们把这个架构移植到了 Windows。

### 架构对比

```
┌───────────────────────────────────────────────────────────┐
│              其他 MCP Server                               │
│                                                           │
│   screenshot() ──→ 模型看 ──→ click(x,y) ──→ 重复        │
│                                                           │
│   无安全模型。无批量执行。无 token 预算。无状态管理。       │
│   模型必须每次都通过视觉解析所有信息。                     │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│              本项目 (Chicago MCP 架构)                     │
│                                                           │
│   会话层:  request_access → 三级权限 (read/click/full)    │
│   效率层:  computer_batch + 结构化 API + token 预算       │
│   视觉层:  screenshot + zoom (仅在真正需要时使用)         │
│   原生层:  node-screenshots │ robotjs │ koffi + Win32     │
└───────────────────────────────────────────────────────────┘
```

### 正面对比：功能碾压

| 能力 | **本项目** | CursorTouch<br/>Windows-MCP<br/>(5k stars) | MCPControl<br/>(306 stars) | domdomegg<br/>computer-use-mcp<br/>(176 stars) | sbroenne<br/>mcp-windows<br/>(24 stars) |
|---|:---:|:---:|:---:|:---:|:---:|
| **批量执行** (N 个动作合 1 次 API 调用) | **Yes** | No | No | No | No |
| **Token 预算优化** (二分搜索 resize 到 ≤1568 tokens) | **Yes** | No | No | No | No |
| **三级应用权限** (read / click / full) | **Yes** | No | No | No | No |
| **前台应用门控** (操作时检查前台应用) | **Yes** | No | No | No | No |
| **危险快捷键拦截** (Alt+F4, Win+L 等) | **Yes** | No | No | No | No |
| **结构化 API** (不截图就能获取信息) | **Yes** | 部分 | 部分 | No | Yes |
| **区域放大** (高清裁剪看小字) | **Yes** | No | No | No | No |
| **多显示器切换** (按名称切换) | **Yes** | No | No | No | No |
| **工具 Schema 与 Claude Code 内置一致** | **Yes** | No | No | 接近 | No |
| **复用 Anthropic 上游代码** | **6,300+ 行** | 0 | 0 | 0 | 0 |
| 工具数量 | 24 | 19 | 12 | 6 | 10 |

### 为什么批量执行这么重要

没有 `computer_batch`，点击一个输入框、输入文字、按回车需要 **5 次 API 往返**，每次 3-8 秒。有了它：

```
// 5 次往返 → 2 次往返。延迟减少 60%，token 减少 60%。
computer_batch([
  { action: "left_click", coordinate: [100, 200] },
  { action: "type", text: "hello world" },
  { action: "key", text: "Return" },
  { action: "screenshot" }
])
```

**其他 Windows MCP Server 都不支持这个。**

### 为什么"能用 API 就用 API"这么重要

其他 MCP 强迫模型**什么都通过截图来感知**。Chicago MCP 的设计原则：能通过平台 API 获取的信息，绝不浪费 vision token。

| 任务 | 其他 MCP 的做法 | 本项目的做法 |
|---|---|---|
| 哪个应用在前台？ | 截图 → 模型读标题栏 | `getFrontmostApp()` → 结构化数据 |
| 鼠标在哪？ | 截图 → 模型猜 | `cursor_position` → 精确 `{x, y}` |
| 读剪贴板 | Ctrl+V 到记事本 → 截图 → 读 | `read_clipboard` → 文本字符串 |
| 打开应用 | 截图 → 找图标 → 点击 | `open_application("Excel")` → API 调用 |

每省一次截图 = 省 **~1,500 vision tokens** + **3-5 秒**延迟。

---

## 快速开始

### 前置条件

- **Node.js** 18+
- **Windows 10/11**
- Visual Studio Build Tools（robotjs 编译需要）

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

重启 Claude Code，即可看到 24 个 `mcp__windows-computer-use__` 前缀的工具。

### 测试

```bash
npm test          # 70 个测试（单元 + 集成）
npm run test:unit # 仅单元测试
```

---

## 安全模型

三级应用权限——**唯一拥有此级别访问控制的 MCP Server**：

| 级别 | 截图可见 | 可点击 | 可输入/粘贴 |
|---|:---:|:---:|:---:|
| **read** (浏览器、交易软件) | Yes | No | No |
| **click** (终端、IDE) | Yes | Yes (仅左键) | No |
| **full** (其他所有) | Yes | Yes | Yes |

另有：危险快捷键拦截、每次操作前的前台应用门控、会话级授权。

## 技术栈

与 Anthropic 的选择对齐——每个库都是 Chicago MCP macOS 版的 Windows 等价物：

| 模块 | macOS (Chicago MCP) | Windows (本项目) |
|---|---|---|
| 截屏 | SCContentFilter | **node-screenshots** (DXGI) |
| 输入 | enigo (Rust) | **robotjs** (SendInput) |
| 窗口管理 | Swift + NSWorkspace | **koffi** + Win32 API |
| 图像处理 | Sharp | **Sharp** |

## 日志

所有 MCP 工具调用记录到：
```
%LOCALAPPDATA%\windows-computer-use-mcp\logs\mcp-YYYY-MM-DD.log
```

## 已知限制

- **中文/CJK 输入**：`type` 工具需要用剪贴板粘贴方式输入非 ASCII 文本（可用 `write_clipboard` + `key("ctrl+v")` 替代）
- **应用发现**：`listInstalledApps` 目前仅返回运行中的应用（注册表扫描已规划）
- **像素校验**：Windows 上已禁用（sharp 是异步的，无法满足同步接口要求）
- **操作前隐藏窗口**：已禁用（Windows 没有 compositor 级窗口过滤，最小化会破坏 WebView2 子进程）

## 许可证

MIT

## 致谢

本项目基于 Anthropic 的 `@ant/computer-use-mcp` 包（Chicago MCP），提取自 Claude Code v2.1.88。`src/upstream/` 中的代码是 Anthropic 的工作；Windows 原生层和集成代码是原创的。
