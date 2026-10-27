/**
 * Hook implementation for b2c:auth-session-store.
 *
 * Keeps the B2C CLI's sign-in sessions (access and refresh tokens) in the
 * macOS Keychain instead of the default `auth-sessions.json` file.
 */

// TODO: Import from @salesforce/b2c-tooling-sdk/cli once published to npm
import type {AuthSessionStoreHook} from '../types.js';
import {KeychainAuthSessionBackend} from '../sessions/keychain-auth-session-backend.js';

const DEFAULT_SERVICE = 'b2c-cli';
const ENV_SERVICE = 'SFCC_KEYCHAIN_SERVICE';
const ENV_AUTH_SESSIONS = 'SFCC_KEYCHAIN_AUTH_SESSIONS';

/**
 * The b2c:auth-session-store hook handler.
 *
 * Returns no backend (keeping the CLI's default store) on other platforms or
 * when `SFCC_KEYCHAIN_AUTH_SESSIONS=false`.
 */
const hook: AuthSessionStoreHook = async function () {
  if (process.platform !== 'darwin') return {};
  if (process.env[ENV_AUTH_SESSIONS]?.toLowerCase() === 'false') {
    this.debug('Keychain auth session store disabled by SFCC_KEYCHAIN_AUTH_SESSIONS');
    return {};
  }

  const service = `${process.env[ENV_SERVICE] ?? DEFAULT_SERVICE}.auth-sessions`;
  this.debug(`Using macOS Keychain auth session store (service: ${service})`);
  return {backend: new KeychainAuthSessionBackend(service)};
};

export default hook;
