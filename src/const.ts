/*
 * These methods use Dexie's original implementation as a fallback instead of the Dexie worker.
 * This fallback is necessary due to limited support for certain features in the worker environment.
 * Using the original methods ensures compatibility where the worker cannot be used.
 */
export const FALLBACK_METHODS = [
  'hook',
  'use',
  'each',
  'transaction',
];