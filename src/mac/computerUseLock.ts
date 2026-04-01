/**
 * Re-export from the shared cross-platform module.
 * Kept for backwards compatibility with any existing imports.
 */
export {
  checkComputerUseLock,
  tryAcquireComputerUseLock,
  releaseComputerUseLock,
  isLockHeldLocally,
} from "../computerUseLock.js";
export type { AcquireResult, CheckResult } from "../computerUseLock.js";
