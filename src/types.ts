/**
 * Local type definitions for B2C CLI plugin interfaces.
 *
 * TODO: Remove this file and import from @salesforce/b2c-tooling-sdk once
 * the package is published to npm.
 */
import type {Hook} from '@oclif/core';

/**
 * Normalized configuration fields that can be provided by a ConfigSource.
 */
export interface NormalizedConfig {
  hostname?: string;
  webdavHostname?: string;
  codeVersion?: string;
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  shortCode?: string;
  mrtProject?: string;
  mrtEnvironment?: string;
  mrtApiKey?: string;
  accountManagerHost?: string;
}

/**
 * Options passed to ConfigSource.load().
 */
export interface ResolveConfigOptions {
  /** Instance name from --instance flag */
  instance?: string;
  /** Config file path from --config flag */
  configPath?: string;
  /** Starting directory for file searches */
  startDir?: string;
}

/**
 * Result of loading configuration from a source.
 */
export interface ConfigLoadResult {
  /** The loaded configuration */
  config: NormalizedConfig;
  /**
   * Location of the source (for diagnostics).
   * May be a file path, keychain entry, URL, or other identifier.
   */
  location?: string;
}

/**
 * Interface for configuration sources.
 */
export interface ConfigSource {
  /** Unique name for this source (used in diagnostics) */
  readonly name: string;

  /**
   * Load configuration from this source.
   * @param options - Resolution options
   * @returns Config and location from this source, or undefined if source is not available
   */
  load(options: ResolveConfigOptions): ConfigLoadResult | undefined;
}

/**
 * Options passed to the b2c:config-sources hook.
 */
export interface ConfigSourcesHookOptions {
  instance?: string;
  configPath?: string;
  resolveOptions: ResolveConfigOptions;
  flags?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Result returned by the b2c:config-sources hook.
 */
export interface ConfigSourcesHookResult {
  sources: ConfigSource[];
  priority?: 'before' | 'after';
}

/**
 * Hook type for b2c:config-sources.
 */
export type ConfigSourcesHook = Hook<'b2c:config-sources'>;

// Module augmentation for oclif to recognize the custom hook
declare module '@oclif/core' {
  interface Hooks {
    'b2c:config-sources': {
      options: ConfigSourcesHookOptions;
      return: ConfigSourcesHookResult;
    };
  }
}
