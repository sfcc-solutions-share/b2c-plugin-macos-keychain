/**
 * B2C CLI plugin for macOS Keychain credential storage.
 *
 * This plugin provides a ConfigSource that reads B2C credentials
 * from the macOS Keychain using the `security` command-line tool.
 *
 * ## Installation
 *
 * ```bash
 * b2c plugins link ~/code/b2c-plugin-macos-keychain
 * ```
 *
 * ## Usage
 *
 * Store credentials in the keychain:
 *
 * ```bash
 * security add-generic-password -s 'b2c-cli:staging' -a 'username' -w 'user@example.com' -U
 * security add-generic-password -s 'b2c-cli:staging' -a 'password' -w 'my-access-key' -U
 * ```
 *
 * Then use the CLI with the instance flag:
 *
 * ```bash
 * b2c code deploy --instance staging
 * ```
 *
 * @module b2c-plugin-macos-keychain
 */

export {KeychainSource} from './sources/keychain-source.js';
export type {ConfigSource, NormalizedConfig, ResolveConfigOptions} from './types.js';
