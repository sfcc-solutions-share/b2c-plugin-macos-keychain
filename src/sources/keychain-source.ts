/**
 * macOS Keychain configuration source.
 *
 * Loads B2C CLI credentials from the macOS Keychain using the
 * `security` command-line tool.
 *
 * @module sources/keychain-source
 */

// TODO: Import from @salesforce/b2c-tooling-sdk/config once published to npm
import type {ConfigSource, ConfigLoadResult, NormalizedConfig, ResolveConfigOptions} from '../types.js';
import {getConfigFromKeychain} from './keychain.js';

/** Default service name for keychain entries */
const DEFAULT_SERVICE = 'b2c-cli';

/** Account name for global defaults */
const GLOBAL_ACCOUNT = '*';

/** Environment variable for service name override */
const ENV_SERVICE = 'SFCC_KEYCHAIN_SERVICE';

/** Environment variable for fallback instance */
const ENV_INSTANCE = 'SFCC_KEYCHAIN_INSTANCE';

/**
 * Extended config type that includes the defaultInstance meta-field.
 */
interface KeychainConfig extends NormalizedConfig {
  /** Default instance to use when none specified (only valid in * config) */
  defaultInstance?: string;
}

/**
 * Configuration source that reads credentials from macOS Keychain.
 *
 * Credentials are stored as JSON blobs in generic passwords:
 * - Service: `b2c-cli` (or custom via SFCC_KEYCHAIN_SERVICE)
 * - Account: `*` for global defaults, or instance name (e.g., 'staging')
 * - Password: JSON object with credentials
 *
 * The `*` account provides global defaults that are always loaded.
 * Instance-specific accounts override global values when merged.
 *
 * @example
 * ```bash
 * # Store global defaults (shared OAuth credentials)
 * security add-generic-password -s 'b2c-cli' -a '*' \
 *   -w '{"clientId":"shared-id","clientSecret":"shared-secret","defaultInstance":"staging"}' -U
 *
 * # Store instance-specific credentials
 * security add-generic-password -s 'b2c-cli' -a 'staging' \
 *   -w '{"username":"user@example.com","password":"my-key"}' -U
 * ```
 */
export class KeychainSource implements ConfigSource {
  readonly name = 'macos-keychain';

  private service: string;

  constructor() {
    this.service = process.env[ENV_SERVICE] ?? DEFAULT_SERVICE;
  }

  /**
   * Load credentials from the macOS Keychain.
   *
   * Resolution flow:
   * 1. Always load global defaults from `*` account (if exists)
   * 2. Determine instance: options.instance → *.defaultInstance → SFCC_KEYCHAIN_INSTANCE
   * 3. If instance determined, load and merge with global (instance overrides)
   * 4. Return merged config (minus defaultInstance meta-field)
   *
   * @param options - Resolution options including instance selection
   * @returns Config and location, or undefined if not available
   */
  load(options: ResolveConfigOptions): ConfigLoadResult | undefined {
    // Only works on macOS
    if (process.platform !== 'darwin') {
      return undefined;
    }

    const locationParts: string[] = [];

    // Step 1: Load global defaults from * account
    const globalConfig = getConfigFromKeychain(this.service, GLOBAL_ACCOUNT) as KeychainConfig | undefined;

    if (globalConfig) {
      locationParts.push(`keychain:${this.service}:${GLOBAL_ACCOUNT}`);
    }

    // Step 2: Determine instance (flag → defaultInstance → env var)
    const instance =
      options.instance ?? globalConfig?.defaultInstance ?? process.env[ENV_INSTANCE];

    // Step 3: Load instance-specific config if we have an instance
    const instanceConfig = instance ? getConfigFromKeychain(this.service, instance) : undefined;

    if (instanceConfig) {
      locationParts.push(`keychain:${this.service}:${instance}`);
    }

    // If neither global nor instance config exists, return undefined
    if (!globalConfig && !instanceConfig) {
      return undefined;
    }

    // Step 4: Merge configs (instance overrides global)
    const merged: NormalizedConfig = {
      ...globalConfig,
      ...instanceConfig,
    };

    // Remove the defaultInstance meta-field from the result
    delete (merged as KeychainConfig).defaultInstance;

    return {
      config: merged,
      location: locationParts.join(','),
    };
  }
}
