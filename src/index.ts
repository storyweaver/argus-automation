/**
 * Windows Computer Use MCP Server — stdio entry point.
 *
 * Launches a standalone MCP server that exposes 25+ computer-use tools
 * for Windows desktop control. Designed to be configured in Claude Code's
 * .mcp.json or any MCP client.
 *
 * Architecture:
 *   This file → createWindowsHostAdapter → createComputerUseMcpServer
 *   → StdioServerTransport
 *
 * The MCP server uses the SAME tool schemas and dispatch logic as
 * Anthropic's built-in Chicago MCP (macOS). Only the native layer
 * (screenshot, input, window management) is Windows-specific.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createComputerUseMcpServer,
  bindSessionContext,
} from "./upstream/mcpServer.js";
import type {
  ComputerUseSessionContext,
  AppGrant,
  CuGrantFlags,
  CoordinateMode,
  CuPermissionResponse,
  CuPermissionRequest,
  ScreenshotDims,
} from "./upstream/types.js";
import { DEFAULT_GRANT_FLAGS } from "./upstream/types.js";
import { createWindowsHostAdapter } from "./host-adapter.js";
import { getLogDir } from "./logger.js";

// ── Simple session context (auto-approve mode for CLI usage) ────────────────

/**
 * Minimal session context for standalone (headless) usage.
 *
 * In Claude Code's desktop app, permission dialogs route through the
 * renderer. In standalone mode, we auto-approve all requests — the user
 * has already opted in by configuring and running the MCP server.
 */
function createAutoApproveSessionContext(): ComputerUseSessionContext {
  let allowedApps: AppGrant[] = [];
  let grantFlags: CuGrantFlags = { ...DEFAULT_GRANT_FLAGS };
  let selectedDisplayId: number | undefined;
  let lastScreenshotDims: ScreenshotDims | undefined;

  return {
    getAllowedApps: () => allowedApps,
    getGrantFlags: () => grantFlags,
    getUserDeniedBundleIds: () => [],
    getSelectedDisplayId: () => selectedDisplayId,
    getLastScreenshotDims: () => lastScreenshotDims,

    onPermissionRequest: async (
      req: CuPermissionRequest,
      _signal: AbortSignal,
    ): Promise<CuPermissionResponse> => {
      // Auto-approve: grant all requested apps at their proposed tier
      const granted: AppGrant[] = req.apps
        .filter((a) => a.resolved && !a.alreadyGranted)
        .map((a) => ({
          bundleId: a.resolved!.bundleId,
          displayName: a.resolved!.displayName,
          grantedAt: Date.now(),
          tier: a.proposedTier,
        }));

      return {
        granted,
        denied: req.apps
          .filter((a) => !a.resolved)
          .map((a) => ({
            bundleId: a.requestedName,
            reason: "not_installed" as const,
          })),
        flags: {
          clipboardRead: req.requestedFlags.clipboardRead ?? false,
          clipboardWrite: req.requestedFlags.clipboardWrite ?? false,
          systemKeyCombos: req.requestedFlags.systemKeyCombos ?? false,
        },
      };
    },

    onAllowedAppsChanged: (apps, flags) => {
      allowedApps = [...apps];
      grantFlags = flags;
    },

    onResolvedDisplayUpdated: (displayId) => {
      selectedDisplayId = displayId;
    },

    onScreenshotCaptured: (dims) => {
      lastScreenshotDims = dims;
    },
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const adapter = createWindowsHostAdapter({
    serverName: "windows-computer-use",
  });

  const coordinateMode: CoordinateMode = "pixels";
  const sessionCtx = createAutoApproveSessionContext();

  const server = createComputerUseMcpServer(
    adapter,
    coordinateMode,
    sessionCtx,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  adapter.logger.info(`Windows Computer Use MCP Server started (stdio). Logs → ${getLogDir()}`);

  // Keep alive until the transport closes
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
