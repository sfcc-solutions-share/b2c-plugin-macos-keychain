/**
 * macOS Keychain CLI wrapper.
 *
 * Provides functions to read generic passwords from the macOS Keychain
 * using the `security` command-line tool.
 *
 * @module sources/keychain
 */

import {execSync} from 'node:child_process';
import type {NormalizedConfig} from '../types.js';

/**
 * Retrieves a password from the macOS Keychain.
 *
 * Uses the `security find-generic-password` command to look up
 * a generic password by service and account name.
 *
 * @param service - The service name (e.g., 'b2c-cli')
 * @param account - The account name (e.g., 'staging', 'production')
 * @returns The password value, or undefined if not found
 *
 * @example
 * ```typescript
 * const json = getPassword('b2c-cli', 'staging');
 * if (json) {
 *   const config = JSON.parse(json);
 * }
 * ```
 */
export function getPassword(service: string, account: string): string | undefined {
  try {
    // Use single quotes around service/account to prevent shell injection
    // The -w flag outputs only the password value
    const result = execSync(
      `security find-generic-password -s '${escapeShellArg(service)}' -a '${escapeShellArg(account)}' -w`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    return result.trim();
  } catch {
    // Command exits with non-zero if password not found
    return undefined;
  }
}

/**
 * Retrieves and parses a JSON config blob from the macOS Keychain.
 *
 * @param service - The service name (e.g., 'b2c-cli')
 * @param account - The account/instance name (e.g., 'staging')
 * @returns Parsed config object, or undefined if not found or invalid
 */
export function getConfigFromKeychain(service: string, account: string): NormalizedConfig | undefined {
  const json = getPassword(service, account);
  if (!json) {
    return undefined;
  }

  try {
    return JSON.parse(json) as NormalizedConfig;
  } catch {
    // Invalid JSON
    return undefined;
  }
}

/**
 * Escapes a string for safe use in shell single quotes.
 * Replaces single quotes with escaped version.
 */
function escapeShellArg(arg: string): string {
  // In single quotes, only single quote needs escaping: ' -> '\''
  return arg.replace(/'/g, "'\\''");
}
