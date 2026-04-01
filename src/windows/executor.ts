/**
 * Windows ComputerExecutor implementation.
 *
 * Assembles native modules (screen, window, input, clipboard) into the
 * ComputerExecutor interface consumed by upstream toolCalls.ts.
 *
 * Mirrors the CLI executor.ts structure but replaces macOS native calls
 * with Windows equivalents.
 */

import type {
  ComputerExecutor,
  DisplayGeometry,
  FrontmostApp,
  InstalledApp,
  ResolvePrepareCaptureResult,
  RunningApp,
  ScreenshotResult,
} from "../upstream/executor.js";
import {
  captureMonitor,
  captureRegion,
  listMonitors,
  getMonitorGeometry,
} from "./screen.js";
import {
  getForegroundWindowInfo,
  getWindowFromPoint,
  listRunningApps as nativeListRunningApps,
  listVisibleWindows,
  hideWindows,
  unhideWindows,
  activateWindow,
  shellOpen,
  findWindowDisplays as nativeFindWindowDisplays,
} from "./window.js";
import {
  moveMouse as nativeMoveMouse,
  getMousePos,
  mouseClick as nativeMouseClick,
  mouseToggle,
  scrollMouse as nativeScrollMouse,
  keyTap,
  keyToggle,
  typeString,
} from "./input.js";
import {
  readClipboard as nativeReadClipboard,
  writeClipboard as nativeWriteClipboard,
} from "./clipboard.js";
import { execFile } from "node:child_process";

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Host bundle ID sentinel. On Windows we're a terminal process — this ID
 * is never the frontmost app (unlike macOS where the terminal window IS
 * visible). The upstream frontmost gate exempts this ID.
 */
const WIN_HOST_BUNDLE_ID = "argus-automation";

/**
 * Windows Explorer — equivalent of macOS Finder. Always allowed as
 * frontmost (desktop, file manager, taskbar).
 */
export const EXPLORER_EXE = "EXPLORER.EXE";

// ── Helpers ─────────────────────────────────────────────────────────────────

const MOVE_SETTLE_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Move the mouse and wait for the position to settle.
 */
async function moveAndSettle(x: number, y: number): Promise<void> {
  nativeMoveMouse(x, y);
  await sleep(MOVE_SETTLE_MS);
}

/**
 * Ease-out-cubic animated mouse movement for drag operations.
 * Port of Cowork's animateMouseMovement.
 */
async function animatedMove(
  targetX: number,
  targetY: number,
  enabled: boolean,
): Promise<void> {
  if (!enabled) {
    await moveAndSettle(targetX, targetY);
    return;
  }

  const start = getMousePos();
  const deltaX = targetX - start.x;
  const deltaY = targetY - start.y;
  const distance = Math.hypot(deltaX, deltaY);

  if (distance < 1) return;

  const durationSec = Math.min(distance / 2000, 0.5);
  if (durationSec < 0.03) {
    await moveAndSettle(targetX, targetY);
    return;
  }

  const frameRate = 60;
  const frameIntervalMs = 1000 / frameRate;
  const totalFrames = Math.floor(durationSec * frameRate);

  for (let frame = 1; frame <= totalFrames; frame++) {
    const t = frame / totalFrames;
    const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
    nativeMoveMouse(
      Math.round(start.x + deltaX * eased),
      Math.round(start.y + deltaY * eased),
    );
    if (frame < totalFrames) {
      await sleep(frameIntervalMs);
    }
  }
  await sleep(MOVE_SETTLE_MS);
}

/**
 * Type text via clipboard paste. Saves/restores the user's clipboard.
 * Same pattern as the macOS CLI executor's typeViaClipboard.
 */
async function typeViaClipboard(text: string): Promise<void> {
  let saved: string | undefined;
  try {
    saved = await nativeReadClipboard();
  } catch {
    // proceed without restore capability
  }

  try {
    await nativeWriteClipboard(text);
    // Verify round-trip
    const readBack = await nativeReadClipboard();
    if (readBack !== text) {
      throw new Error("Clipboard write did not round-trip.");
    }
    // Ctrl+V to paste
    keyTap("ctrl+v");
    await sleep(100);
  } finally {
    if (typeof saved === "string") {
      try {
        await nativeWriteClipboard(saved);
      } catch {
        // best-effort restore
      }
    }
  }
}

// ── Registry-based installed-app scan ───────────────────────────────────────

/** Cached result of the registry scan. */
let _regApps: InstalledApp[] | null = null;
let _regAppsTs = 0;
const REG_CACHE_TTL = 5 * 60_000; // 5 minutes

/**
 * Scan the Windows Uninstall registry keys for installed applications.
 * Queries HKLM (64-bit + WOW6432Node) and HKCU.  Only entries with a
 * recognisable .exe in DisplayIcon are returned.  Results are cached.
 */
async function getRegistryInstalledApps(): Promise<InstalledApp[]> {
  const now = Date.now();
  if (_regApps && now - _regAppsTs < REG_CACHE_TTL) return _regApps;

  const script =
    "$ErrorActionPreference='SilentlyContinue'\n" +
    "$r=@(\n" +
    "  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',\n" +
    "  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',\n" +
    "  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'\n" +
    ")\n" +
    "$a=$r|%{Get-ItemProperty $_}|?{\n" +
    "  $_.DisplayName -and !$_.SystemComponent -and\n" +
    "  $_.DisplayName -notmatch '^(KB\\d|Update |Security Update|Hotfix)'\n" +
    "}|%{\n" +
    "  $x=''\n" +
    "  if($_.DisplayIcon){$x=($_.DisplayIcon -split ',')[0].Trim('\"').Trim()}\n" +
    "  if($x -match '\\.exe$' -and $x -notmatch '(msiexec|rundll32)'){[pscustomobject]@{n=$_.DisplayName.Trim();x=$x}}\n" +
    "}|?{$_}|Sort-Object n -Unique\n" +
    "if($a){$a|ConvertTo-Json -Compress}else{'[]'}";

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { timeout: 15_000 },
        (err, out) => (err ? reject(err) : resolve(out)),
      );
    });

    const raw = JSON.parse(stdout.trim() || "[]");
    const items: Array<{ n: string; x: string }> = Array.isArray(raw)
      ? raw
      : [raw];

    const seen = new Set<string>();
    const apps: InstalledApp[] = [];
    for (const { n, x } of items) {
      if (!n || !x) continue;
      const exeName = x.match(/([^\\\/]+)$/)?.[1];
      if (!exeName) continue;
      const id = exeName.toUpperCase();
      if (seen.has(id)) continue;
      seen.add(id);
      apps.push({ bundleId: id, displayName: n, path: x });
    }

    _regApps = apps;
    _regAppsTs = now;
    return apps;
  } catch {
    // Registry scan is best-effort; fall through to running-apps only.
    return [];
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createWindowsExecutor(opts: {
  getMouseAnimationEnabled: () => boolean;
  getHideBeforeActionEnabled: () => boolean;
}): ComputerExecutor {
  const { getMouseAnimationEnabled, getHideBeforeActionEnabled } = opts;

  return {
    capabilities: {
      screenshotFiltering: "none", // Windows can't filter windows from screenshots
      platform: "win32",
      hostBundleId: WIN_HOST_BUNDLE_ID,
      teachMode: false,
    },

    // ── Pre-action sequence ───────────────────────────────────────────────

    async prepareForAction(
      allowlistBundleIds: string[],
      _displayId?: number,
    ): Promise<string[]> {
      if (!getHideBeforeActionEnabled()) {
        return [];
      }

      const allowSet = new Set(
        allowlistBundleIds.map((id) => id.toUpperCase()),
      );
      // Always allow explorer.exe (desktop/taskbar)
      allowSet.add(EXPLORER_EXE);
      // Allow the host process
      allowSet.add(WIN_HOST_BUNDLE_ID.toUpperCase());

      const running = nativeListRunningApps();
      const toHide = running
        .filter((app) => !allowSet.has(app.bundleId.toUpperCase()))
        .map((app) => app.bundleId);

      if (toHide.length > 0) {
        hideWindows(toHide);
      }

      // Activate the first allowed app so our host isn't frontmost
      for (const id of allowlistBundleIds) {
        if (activateWindow(id)) break;
      }

      return toHide;
    },

    async previewHideSet(
      allowlistBundleIds: string[],
      _displayId?: number,
    ): Promise<Array<{ bundleId: string; displayName: string }>> {
      const allowSet = new Set(
        allowlistBundleIds.map((id) => id.toUpperCase()),
      );
      allowSet.add(EXPLORER_EXE);
      allowSet.add(WIN_HOST_BUNDLE_ID.toUpperCase());

      const running = nativeListRunningApps();
      return running.filter(
        (app) => !allowSet.has(app.bundleId.toUpperCase()),
      );
    },

    // ── Display ───────────────────────────────────────────────────────────

    async getDisplaySize(displayId?: number): Promise<DisplayGeometry> {
      return getMonitorGeometry(displayId);
    },

    async listDisplays(): Promise<DisplayGeometry[]> {
      return listMonitors();
    },

    async findWindowDisplays(
      bundleIds: string[],
    ): Promise<Array<{ bundleId: string; displayIds: number[] }>> {
      return nativeFindWindowDisplays(bundleIds);
    },

    async resolvePrepareCapture(opts: {
      allowedBundleIds: string[];
      preferredDisplayId?: number;
      autoResolve: boolean;
      doHide?: boolean;
    }): Promise<ResolvePrepareCaptureResult> {
      let hidden: string[] = [];

      // Hide non-allowlisted apps if requested
      if (opts.doHide) {
        hidden = await this.prepareForAction(
          opts.allowedBundleIds,
          opts.preferredDisplayId,
        );
      }

      // Capture screenshot
      try {
        const screenshot = await captureMonitor(opts.preferredDisplayId);
        return {
          ...screenshot,
          hidden,
        };
      } catch (err) {
        const geo = getMonitorGeometry(opts.preferredDisplayId);
        return {
          base64: "",
          width: 0,
          height: 0,
          displayWidth: geo.width,
          displayHeight: geo.height,
          displayId: geo.displayId,
          originX: geo.originX,
          originY: geo.originY,
          hidden,
          captureError: err instanceof Error ? err.message : String(err),
        };
      }
    },

    // ── Screenshot ────────────────────────────────────────────────────────

    async screenshot(opts: {
      allowedBundleIds: string[];
      displayId?: number;
    }): Promise<ScreenshotResult> {
      return captureMonitor(opts.displayId);
    },

    async zoom(
      regionLogical: { x: number; y: number; w: number; h: number },
      _allowedBundleIds: string[],
      displayId?: number,
    ): Promise<{ base64: string; width: number; height: number }> {
      const geo = getMonitorGeometry(displayId);
      // Compute target dimensions for the zoomed region
      const { targetImageSize, API_RESIZE_PARAMS } = await import(
        "../upstream/imageResize.js"
      );
      const physW = Math.round(regionLogical.w * geo.scaleFactor);
      const physH = Math.round(regionLogical.h * geo.scaleFactor);
      const [outW, outH] = targetImageSize(physW, physH, API_RESIZE_PARAMS);

      return captureRegion(
        regionLogical.x,
        regionLogical.y,
        regionLogical.w,
        regionLogical.h,
        outW,
        outH,
        75,
        displayId,
      );
    },

    // ── Keyboard ──────────────────────────────────────────────────────────

    async key(keySequence: string, repeat?: number): Promise<void> {
      const n = repeat ?? 1;
      for (let i = 0; i < n; i++) {
        if (i > 0) await sleep(8);
        keyTap(keySequence);
      }
    },

    async holdKey(keyNames: string[], durationMs: number): Promise<void> {
      const pressed: string[] = [];
      try {
        for (const k of keyNames) {
          keyToggle(k, "press");
          pressed.push(k);
        }
        await sleep(durationMs);
      } finally {
        for (const k of pressed.reverse()) {
          try {
            keyToggle(k, "release");
          } catch {
            // swallow — best-effort release
          }
        }
      }
    },

    async type(text: string, opts: { viaClipboard: boolean }): Promise<void> {
      // Force clipboard paste for non-ASCII text (CJK etc.) — robotjs
      // typeString triggers the system IME and produces garbled output.
      if (opts.viaClipboard || /[^\x00-\x7F]/.test(text)) {
        await typeViaClipboard(text);
        return;
      }
      typeString(text);
    },

    // ── Clipboard ─────────────────────────────────────────────────────────

    async readClipboard(): Promise<string> {
      return nativeReadClipboard();
    },

    async writeClipboard(text: string): Promise<void> {
      return nativeWriteClipboard(text);
    },

    // ── Mouse ─────────────────────────────────────────────────────────────

    async moveMouse(x: number, y: number): Promise<void> {
      await moveAndSettle(x, y);
    },

    async click(
      x: number,
      y: number,
      button: "left" | "right" | "middle",
      count: 1 | 2 | 3,
      modifiers?: string[],
    ): Promise<void> {
      await moveAndSettle(x, y);

      if (modifiers && modifiers.length > 0) {
        // Press modifiers
        for (const m of modifiers) {
          keyToggle(m, "press");
        }
        try {
          nativeMouseClick(button, count);
        } finally {
          // Release modifiers in reverse
          for (const m of [...modifiers].reverse()) {
            try {
              keyToggle(m, "release");
            } catch {
              // best-effort
            }
          }
        }
      } else {
        nativeMouseClick(button, count);
      }
    },

    async mouseDown(): Promise<void> {
      mouseToggle("press", "left");
    },

    async mouseUp(): Promise<void> {
      mouseToggle("release", "left");
    },

    async getCursorPosition(): Promise<{ x: number; y: number }> {
      return getMousePos();
    },

    async drag(
      from: { x: number; y: number } | undefined,
      to: { x: number; y: number },
    ): Promise<void> {
      if (from !== undefined) {
        await moveAndSettle(from.x, from.y);
      }
      mouseToggle("press", "left");
      await sleep(MOVE_SETTLE_MS);
      try {
        await animatedMove(to.x, to.y, getMouseAnimationEnabled());
      } finally {
        mouseToggle("release", "left");
      }
    },

    async scroll(
      x: number,
      y: number,
      dx: number,
      dy: number,
    ): Promise<void> {
      await moveAndSettle(x, y);
      if (dy !== 0) {
        nativeScrollMouse(
          Math.abs(dy),
          dy > 0 ? "down" : "up",
        );
      }
      if (dx !== 0) {
        nativeScrollMouse(
          Math.abs(dx),
          dx > 0 ? "right" : "left",
        );
      }
    },

    // ── App management ────────────────────────────────────────────────────

    async getFrontmostApp(): Promise<FrontmostApp | null> {
      const info = getForegroundWindowInfo();
      if (!info) return null;
      return {
        bundleId: info.exeName.toUpperCase(),
        displayName: info.title || info.exeName.replace(/\.exe$/i, ""),
      };
    },

    async appUnderPoint(
      x: number,
      y: number,
    ): Promise<{ bundleId: string; displayName: string } | null> {
      const info = getWindowFromPoint(x, y);
      if (!info) return null;
      return {
        bundleId: info.exeName.toUpperCase(),
        displayName: info.title || info.exeName.replace(/\.exe$/i, ""),
      };
    },

    async listInstalledApps(): Promise<InstalledApp[]> {
      // Merge registry-scanned apps (comprehensive) with running apps
      // (catches portable apps and provides fresh window titles).
      const [registryApps, visibleWindows] = await Promise.all([
        getRegistryInstalledApps(),
        Promise.resolve(listVisibleWindows()),
      ]);

      const byId = new Map<string, InstalledApp>();

      for (const app of registryApps) {
        byId.set(app.bundleId, app);
      }

      // Running apps fill gaps (portable / unregistered apps)
      for (const w of visibleWindows) {
        const id = w.exeName.toUpperCase();
        if (!byId.has(id)) {
          byId.set(id, {
            bundleId: id,
            displayName: w.title || w.exeName.replace(/\.exe$/i, ""),
            path: w.exePath,
          });
        }
      }

      return Array.from(byId.values());
    },

    async getAppIcon(_path: string): Promise<string | undefined> {
      // No icon extraction on Windows MVP. The approval dialog
      // falls back to a grey box when undefined.
      return undefined;
    },

    async listRunningApps(): Promise<RunningApp[]> {
      return nativeListRunningApps();
    },

    async openApp(bundleId: string): Promise<void> {
      // Try to activate existing window first
      if (activateWindow(bundleId)) return;
      // Otherwise try to launch by exe name
      shellOpen(bundleId);
    },
  };
}
