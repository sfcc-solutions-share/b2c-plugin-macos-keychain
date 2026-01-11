/**
 * Hook implementation for b2c:config-sources.
 *
 * This hook provides the macOS Keychain configuration source
 * to the B2C CLI configuration resolution system.
 */

// TODO: Import from @salesforce/b2c-tooling-sdk/cli once published to npm
import type {ConfigSourcesHook} from '../types.js';
import {KeychainSource} from '../sources/keychain-source.js';

/**
 * The b2c:config-sources hook handler.
 *
 * Returns the macOS Keychain configuration source with 'after' priority,
 * meaning it fills in credentials after other sources provide hostname,
 * code-version, etc.
 */
const hook: ConfigSourcesHook = async function (options) {
  this.debug(`b2c:config-sources hook called with instance: ${options.instance}`);

  return {
    sources: [new KeychainSource()],
    // 'after' = fill in credentials after dw.json provides other settings
    priority: 'after',
  };
};

export default hook;
