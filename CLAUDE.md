# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
npm run build          # TypeScript compilation (tsc) → dist/
npm test               # Run all tests (unit + integration)
npm run test:unit      # Unit tests only
npm run test:integration  # Integration tests only (interact with real desktop)
npx tsc --noEmit       # Type-check without emitting
npm start              # Run the MCP server (stdio transport)
```

Tests run **sequentially** (fileParallelism: false) because clipboard and input tests share OS state. ESM module system — all imports use `.js` extensions.

## Architecture

Three layers: **upstream** (Anthropic's Chicago MCP, platform-agnostic) → **platform executor** (macOS or Windows) → **native modules**.

```
server-mcp.ts (entry point)
  ├─ process.platform === "darwin"
  │    → mac/hostAdapter.ts → mac/executor.ts
  │        → @ant/computer-use-swift  (SCContentFilter, NSWorkspace, TCC)
  │        → @ant/computer-use-input  (Rust/enigo mouse+keyboard)
  │        → mac/drainRunLoop.ts      (CFRunLoop pump — critical!)
  │
  └─ process.platform === "win32"
       → windows/host-adapter.ts → windows/executor.ts
           → windows/screen.ts    (node-screenshots + sharp)
           → windows/input.ts     (robotjs)
           → windows/window.ts    (koffi + Win32 API)
           → windows/clipboard.ts (PowerShell)

Both paths feed into:
  upstream/ (6,300 lines, DO NOT MODIFY)
    toolCalls.ts — 3,649-line dispatch engine
    mcpServer.ts — bindSessionContext + MCP Server
    tools.ts     — 24 tool schema definitions
    types.ts     — all interfaces
    executor.ts  — ComputerExecutor interface (the abstraction boundary)
```

### Key rule: upstream/ is read-only

The `src/upstream/` directory contains Anthropic's Chicago MCP code from `@ant/computer-use-mcp`. Only 1 line was changed (toolCalls.ts:1162). Never modify these files.

### macOS path (src/mac/)

**Original Claude Code computer-use implementation**, extracted with minimal changes. Uses Anthropic's proprietary native modules (`@ant/computer-use-swift`, `@ant/computer-use-input`) for SCContentFilter screenshots, enigo input, and real TCC permission checks.

`shims.ts` is the only new file — provides standalone replacements for Claude Code infrastructure (logging, sleep, session ID, etc.). All other files are copied from the original with only import paths changed.

**Critical**: `drainRunLoop.ts` pumps CFRunLoop every 1ms while native calls are pending. Without this, Swift @MainActor methods and enigo key() hang forever under Node's libuv (unlike Electron which drains CFRunLoop automatically).

### Windows path (src/windows/)

Custom implementation using cross-platform and Windows-specific libraries. Written from scratch to match the ComputerExecutor interface.

### CU Lock (cross-process mutex)

Prevents two Claude sessions from using the computer simultaneously.
- **Shared**: `src/computerUseLock.ts` — O_EXCL file lock at `~/.claude/computer-use.lock` (platform-agnostic, works on macOS/Windows/Linux via Node.js `flag:'wx'` → `CreateFileW(CREATE_NEW)` on Windows)
- `mac/computerUseLock.ts` re-exports from the shared module for backwards compatibility

When another session holds the lock, upstream returns: "Another Claude session is currently using the computer."

### Sub-gates (CuSubGates)

| Gate | macOS | Windows | Why |
|------|-------|---------|-----|
| pixelValidation | false | false | cropRawPatch interface is sync, sharp is async |
| hideBeforeAction | **true** | false | macOS compositor hiding is safe; Windows minimize breaks WebView2 |
| mouseAnimation | true | true | Ease-out-cubic for drag operations |
| autoTargetDisplay | false | false | Needs atomic Swift resolver |
| clipboardGuard | false | false | No Electron clipboard module |

## Deployment

### macOS

Requires `@ant/computer-use-swift` and `@ant/computer-use-input` native modules (from Claude Code installation). Grant Accessibility + Screen Recording permissions to the terminal app.

```json
{
  "mcpServers": {
    "argus": {
      "command": "node",
      "args": ["/path/to/argus-automation/dist/server-mcp.js"]
    }
  }
}
```

### Windows

```bash
npm install   # installs node-screenshots, robotjs, koffi, sharp
npm run build
```

```json
{
  "mcpServers": {
    "argus": {
      "command": "node",
      "args": ["D:/path/to/argus-automation/dist/server-mcp.js"]
    }
  }
}
```

No special permissions needed. Logs at `%LOCALAPPDATA%\argus-automation\logs\`.

## Known platform issues

### Windows
- **CJK text input**: ~~robotjs `typeString` triggers IME → garbled.~~ Fixed — `type()` now auto-detects non-ASCII and forces clipboard paste.
- **robotjs modifier quirk**: `keyTap(key, undefined)` throws — pass `[]`.
- **FINDER_BUNDLE_ID**: upstream hardcodes `com.apple.finder` as always-allowed. Windows `EXPLORER.EXE` won't match — add Explorer to allowlist.
- **listInstalledApps**: ~~Only returns running apps.~~ Fixed — scans Uninstall registry keys (HKLM + HKCU, 64/32-bit) and merges with running apps. Cached for 5 minutes.

### macOS
- **Terminal exemption**: The terminal running Claude Code is auto-detected and excluded from screenshots/hiding via `getTerminalBundleId()`.
- **TCC permissions**: Accessibility + Screen Recording must be granted. `request_access` shows the TCC state if not granted.

## Logs

- **macOS**: `~/Library/Logs/argus-automation/mcp-YYYY-MM-DD.log`
- **Windows**: `%LOCALAPPDATA%\argus-automation\logs\mcp-YYYY-MM-DD.log`
- **Linux**: `~/.local/state/argus-automation/logs/mcp-YYYY-MM-DD.log`
