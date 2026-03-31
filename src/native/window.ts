/**
 * Window management module — wraps koffi + Win32 API.
 *
 * Equivalent of the Swift code in @ant/computer-use-swift for app management.
 * Uses koffi for FFI calls to user32.dll, kernel32.dll, shell32.dll.
 */

import koffi from "koffi";
import { Window as NsWindow } from "node-screenshots";

// ── Win32 FFI Setup ─────────────────────────────────────────────────────────

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");
const shell32 = koffi.load("shell32.dll");

// Type aliases
const HWND = "void *";
const HANDLE = "void *";
const BOOL = "int";
const DWORD = "uint32";
const UINT = "uint32";
const LONG = "int32";
const LPARAM = "int64";
const LRESULT = "int64";

// POINT struct
const POINT = koffi.struct("POINT", {
  x: LONG,
  y: LONG,
});

// ── user32.dll functions ────────────────────────────────────────────────────

const GetForegroundWindow = user32.func("GetForegroundWindow", HWND, []);
const GetWindowThreadProcessId = user32.func(
  "GetWindowThreadProcessId",
  DWORD,
  [HWND, koffi.out(koffi.pointer(DWORD))],
);
const WindowFromPoint = user32.func("WindowFromPoint", HWND, [POINT]);
const SetForegroundWindow = user32.func("SetForegroundWindow", BOOL, [HWND]);
const ShowWindow = user32.func("ShowWindow", BOOL, [HWND, "int"]);
const IsWindowVisible = user32.func("IsWindowVisible", BOOL, [HWND]);
const GetWindowTextW = user32.func("GetWindowTextW", "int", [
  HWND,
  koffi.out(koffi.pointer("uint16")),
  "int",
]);
const GetWindowTextLengthW = user32.func("GetWindowTextLengthW", "int", [HWND]);
const GetAncestor = user32.func("GetAncestor", HWND, [HWND, UINT]);
const GetClassNameW = user32.func("GetClassNameW", "int", [
  HWND,
  koffi.out(koffi.pointer("uint16")),
  "int",
]);

// EnumWindows callback type
const WNDENUMPROC = koffi.proto("WNDENUMPROC", BOOL, [HWND, LPARAM]);
const EnumWindows = user32.func("EnumWindows", BOOL, [
  koffi.pointer(WNDENUMPROC),
  LPARAM,
]);

// ── kernel32.dll functions ──────────────────────────────────────────────────

const OpenProcess = kernel32.func("OpenProcess", HANDLE, [DWORD, BOOL, DWORD]);
const CloseHandle = kernel32.func("CloseHandle", BOOL, [HANDLE]);
const QueryFullProcessImageNameW = kernel32.func(
  "QueryFullProcessImageNameW",
  BOOL,
  [HANDLE, DWORD, koffi.out(koffi.pointer("uint16")), koffi.inout(koffi.pointer(DWORD))],
);

// ── shell32.dll functions ───────────────────────────────────────────────────

const ShellExecuteW = shell32.func("ShellExecuteW", "void *", [
  HWND,
  "const uint16 *",
  "const uint16 *",
  "const uint16 *",
  "const uint16 *",
  "int",
]);

// ── Constants ───────────────────────────────────────────────────────────────

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const SW_HIDE = 0;
const SW_SHOW = 5;
const SW_MINIMIZE = 6;
const SW_RESTORE = 9;
const SW_SHOWNOACTIVATE = 4;
const GA_ROOTOWNER = 3;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read a wide string (UTF-16LE) from a buffer.
 */
function readWideString(buffer: Uint16Array): string {
  let end = buffer.indexOf(0);
  if (end === -1) end = buffer.length;
  return String.fromCharCode(...buffer.slice(0, end));
}

/**
 * Encode a JS string to UTF-16LE buffer for Win32 W functions.
 */
function toWideString(str: string): Buffer {
  const buf = Buffer.alloc((str.length + 1) * 2);
  for (let i = 0; i < str.length; i++) {
    buf.writeUInt16LE(str.charCodeAt(i), i * 2);
  }
  buf.writeUInt16LE(0, str.length * 2);
  return buf;
}

/**
 * Get the executable name for a given PID.
 * Returns the full path, or null if the process can't be queried.
 */
function getProcessExePath(pid: number): string | null {
  const hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!hProcess) return null;

  try {
    const pathBuf = new Uint16Array(1024);
    const size = new Uint32Array([1024]);
    const ok = QueryFullProcessImageNameW(hProcess, 0, pathBuf, size);
    if (!ok) return null;
    return readWideString(pathBuf);
  } finally {
    CloseHandle(hProcess);
  }
}

/**
 * Extract the exe filename from a full path.
 * "C:\\Program Files\\...\\EXCEL.EXE" → "EXCEL.EXE"
 */
function exeNameFromPath(fullPath: string): string {
  const parts = fullPath.split("\\");
  return parts[parts.length - 1]!;
}

/**
 * Get the PID of a window's owning process.
 */
function getWindowPid(hwnd: unknown): number {
  const pidBuf = new Uint32Array(1);
  GetWindowThreadProcessId(hwnd, pidBuf);
  return pidBuf[0]!;
}

/**
 * Get the title of a window.
 */
function getWindowTitle(hwnd: unknown): string {
  const len = GetWindowTextLengthW(hwnd);
  if (len <= 0) return "";
  const buf = new Uint16Array(len + 1);
  GetWindowTextW(hwnd, buf, len + 1);
  return readWideString(buf);
}

/**
 * Get the class name of a window.
 */
function getWindowClassName(hwnd: unknown): string {
  const buf = new Uint16Array(256);
  GetClassNameW(hwnd, buf, 256);
  return readWideString(buf);
}

// ── Window info type ────────────────────────────────────────────────────────

export interface WindowInfo {
  hwnd: unknown;
  pid: number;
  exeName: string;
  exePath: string;
  title: string;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get info about the foreground (frontmost) window.
 */
export function getForegroundWindowInfo(): WindowInfo | null {
  const hwnd = GetForegroundWindow();
  if (!hwnd) return null;

  const pid = getWindowPid(hwnd);
  if (pid === 0) return null;

  const exePath = getProcessExePath(pid);
  if (!exePath) return null;

  return {
    hwnd,
    pid,
    exeName: exeNameFromPath(exePath),
    exePath,
    title: getWindowTitle(hwnd),
  };
}

/**
 * Get info about the window at a given screen point.
 */
export function getWindowFromPoint(
  x: number,
  y: number,
): WindowInfo | null {
  const point = { x: Math.round(x), y: Math.round(y) };
  const hwnd = WindowFromPoint(point);
  if (!hwnd) return null;

  // Walk to root owner for consistency (child controls → parent window)
  const rootHwnd = GetAncestor(hwnd, GA_ROOTOWNER) || hwnd;
  const pid = getWindowPid(rootHwnd);
  if (pid === 0) return null;

  const exePath = getProcessExePath(pid);
  if (!exePath) return null;

  return {
    hwnd: rootHwnd,
    pid,
    exeName: exeNameFromPath(exePath),
    exePath,
    title: getWindowTitle(rootHwnd),
  };
}

/**
 * Enumerate all visible top-level windows with their process info.
 * Uses node-screenshots' Window.all() for reliable enumeration,
 * enriched with process path from Win32.
 */
export function listVisibleWindows(): WindowInfo[] {
  const results: WindowInfo[] = [];
  const nsWindows = NsWindow.all();

  for (const w of nsWindows) {
    if (w.isMinimized()) continue;

    const pid = w.pid();
    const exePath = getProcessExePath(pid);
    if (!exePath) continue;

    const exeName = exeNameFromPath(exePath);
    // Filter out Windows shell/system windows
    if (
      exeName.toLowerCase() === "shellexperiencehost.exe" ||
      exeName.toLowerCase() === "textinputhost.exe" ||
      exeName.toLowerCase() === "searchhost.exe"
    ) {
      continue;
    }

    results.push({
      hwnd: null, // node-screenshots doesn't expose HWND
      pid,
      exeName,
      exePath,
      title: w.title(),
    });
  }

  // Deduplicate by PID (same app may have multiple windows)
  const seen = new Set<number>();
  return results.filter((w) => {
    if (seen.has(w.pid)) return false;
    seen.add(w.pid);
    return true;
  });
}

/**
 * List all running apps (visible windows, deduped by exe name).
 */
export function listRunningApps(): Array<{
  bundleId: string;
  displayName: string;
}> {
  const windows = listVisibleWindows();
  const seen = new Set<string>();
  const result: Array<{ bundleId: string; displayName: string }> = [];

  for (const w of windows) {
    const id = w.exeName.toUpperCase();
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({
      bundleId: w.exeName.toUpperCase(),
      displayName: w.title || w.exeName.replace(/\.exe$/i, ""),
    });
  }

  return result;
}

/**
 * Minimize windows belonging to specified processes (by exe name).
 * Uses SW_MINIMIZE instead of SW_HIDE so windows remain in the taskbar.
 */
export function hideWindows(exeNames: string[]): void {
  const targets = new Set(exeNames.map((n) => n.toUpperCase()));

  const callback = koffi.register(
    (hwnd: unknown, _lParam: unknown) => {
      if (!IsWindowVisible(hwnd)) return 1; // continue
      const pid = getWindowPid(hwnd);
      const path = getProcessExePath(pid);
      if (!path) return 1;
      const exe = exeNameFromPath(path).toUpperCase();
      if (targets.has(exe)) {
        ShowWindow(hwnd, SW_MINIMIZE);
      }
      return 1; // continue enumeration
    },
    koffi.pointer(WNDENUMPROC),
  );

  EnumWindows(callback, 0);
  koffi.unregister(callback);
}

/**
 * Show (unhide) windows belonging to specified processes.
 */
export function unhideWindows(exeNames: string[]): void {
  const targets = new Set(exeNames.map((n) => n.toUpperCase()));

  const callback = koffi.register(
    (hwnd: unknown, _lParam: unknown) => {
      const pid = getWindowPid(hwnd);
      const path = getProcessExePath(pid);
      if (!path) return 1;
      const exe = exeNameFromPath(path).toUpperCase();
      if (targets.has(exe)) {
        ShowWindow(hwnd, SW_SHOW);
      }
      return 1;
    },
    koffi.pointer(WNDENUMPROC),
  );

  EnumWindows(callback, 0);
  koffi.unregister(callback);
}

/**
 * Bring a window to the foreground by exe name.
 * Finds the first visible window for the process and activates it.
 */
export function activateWindow(exeName: string): boolean {
  const target = exeName.toUpperCase();
  let found = false;

  const callback = koffi.register(
    (hwnd: unknown, _lParam: unknown) => {
      if (found) return 0; // stop
      if (!IsWindowVisible(hwnd)) return 1;
      const pid = getWindowPid(hwnd);
      const path = getProcessExePath(pid);
      if (!path) return 1;
      const exe = exeNameFromPath(path).toUpperCase();
      if (exe === target) {
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
        found = true;
        return 0;
      }
      return 1;
    },
    koffi.pointer(WNDENUMPROC),
  );

  EnumWindows(callback, 0);
  koffi.unregister(callback);
  return found;
}

/**
 * Open/launch an application by its executable path or name.
 */
export function shellOpen(target: string): void {
  const operation = toWideString("open");
  const file = toWideString(target);
  ShellExecuteW(null, operation, file, null, null, SW_SHOWNOACTIVATE);
}

/**
 * Find which monitors have windows for given exe names.
 * Uses node-screenshots Window.all() which provides currentMonitor().
 */
export function findWindowDisplays(
  exeNames: string[],
): Array<{ bundleId: string; displayIds: number[] }> {
  const targets = new Set(exeNames.map((n) => n.toUpperCase()));
  const result = new Map<string, Set<number>>();

  const nsWindows = NsWindow.all();
  for (const w of nsWindows) {
    if (w.isMinimized()) continue;
    const pid = w.pid();
    const path = getProcessExePath(pid);
    if (!path) continue;
    const exe = exeNameFromPath(path).toUpperCase();
    if (!targets.has(exe)) continue;

    const monitor = w.currentMonitor();
    const displayId = monitor.id();

    if (!result.has(exe)) {
      result.set(exe, new Set());
    }
    result.get(exe)!.add(displayId);
  }

  return Array.from(result.entries()).map(([bundleId, ids]) => ({
    bundleId,
    displayIds: Array.from(ids),
  }));
}
