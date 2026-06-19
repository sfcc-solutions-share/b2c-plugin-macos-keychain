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

/** Account prefix for MRT origin-scoped credentials (e.g. `mrt:cloud-staging.mobify.com`) */
const MRT_ACCOUNT_PREFIX = 'mrt:';

/**
 * Hostname of the default MRT cloud origin (`https://cloud.mobify.com`).
 *
 * When no `--cloud-origin` is provided, MRT commands fall back to this origin —
 * but only *after* configuration resolution, so the plugin never receives it in
 * `options.cloudOrigin`. We mirror that default here so an `mrt:cloud.mobify.com`
 * entry resolves for plain `b2c mrt ...` commands with no explicit origin.
 */
const DEFAULT_MRT_HOSTNAME = 'cloud.mobify.com';

/** Environment variable for service name override */
const ENV_SERVICE = 'SFCC_KEYCHAIN_SERVICE';

/** Environment variable for fallback instance */
const ENV_INSTANCE = 'SFCC_KEYCHAIN_INSTANCE';

/**
 * Credential fields that must come from the same keychain layer.
 *
 * Copied from the SDK's `ConfigResolver` (config/resolver.ts) because the SDK
 * does not export it. The SDK applies this protection *across sources*; the
 * keychain source returns a single pre-merged blob, so the SDK can no longer see
 * the split — we must enforce the same grouping *within* our own layered merge.
 * Keep this in sync with the SDK definition.
 */
const CREDENTIAL_GROUPS: (keyof NormalizedConfig)[][] = [
  ['clientId', 'clientSecret'],
  ['username', 'password'],
  ['slasClientId', 'slasClientSecret'],
];

/**
 * Merge keychain layers with group-aware credential protection.
 *
 * Independent fields cascade normally: a more-specific layer overrides a
 * less-specific one field-by-field. But credential groups are protected: the
 * *most-specific* layer that touches a group claims it entirely, and no
 * less-specific layer may contribute the other half. This prevents handing back,
 * say, a `clientId` from `*` paired with a `clientSecret` from an instance entry
 * (an incoherent credential the platform would reject).
 *
 * Mirrors the SDK's `ConfigResolver`, which walks sources high-priority-first and
 * skips fields whose credential group is already claimed. We process layers in the
 * same order — most-specific first — and lock a group on first contact.
 *
 * Behavior matches a plain field cascade unless a layer defines only a *partial*
 * credential pair; only then does the protection diverge by refusing to borrow the
 * missing half from a lower layer.
 *
 * @param layers - Configs ordered MOST-specific first (e.g. [origin, instance, global])
 * @returns Merged config
 */
function mergeLayersWithGroupProtection(layers: (NormalizedConfig | undefined)[]): NormalizedConfig {
  const merged: NormalizedConfig = {};
  const claimedGroups = new Set<number>();

  for (const layer of layers) {
    if (!layer) continue;

    // Which groups does THIS layer touch? Capture before writing so a layer can
    // always provide a complete pair of its own.
    const groupsTouchedByLayer = new Set<number>();
    for (const key of Object.keys(layer)) {
      if ((layer as Record<string, unknown>)[key] === undefined) continue;
      const gi = CREDENTIAL_GROUPS.findIndex((g) => g.includes(key as keyof NormalizedConfig));
      if (gi !== -1) groupsTouchedByLayer.add(gi);
    }

    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      const field = key as keyof NormalizedConfig;

      // Skip if a more-specific layer already set this field.
      if (merged[field] !== undefined) continue;

      // Skip if this field's credential group was claimed by a more-specific layer.
      const groupIndex = CREDENTIAL_GROUPS.findIndex((g) => g.includes(field));
      if (groupIndex !== -1 && claimedGroups.has(groupIndex)) continue;

      (merged as Record<string, unknown>)[key] = value;
    }

    // After processing, this layer owns every group it touched.
    for (const gi of groupsTouchedByLayer) claimedGroups.add(gi);
  }

  return merged;
}

/**
 * Reduce an MRT cloud origin to a bare hostname for use as a keychain account.
 *
 * The SDK delivers `options.cloudOrigin` un-normalized — it may be a full URL
 * (`https://cloud-staging.mobify.com`), a bare hostname (`cloud-staging.mobify.com`),
 * or carry a trailing slash. We normalize to just the hostname so a key stored
 * once resolves regardless of how the origin was spelled on the command line.
 * This mirrors the built-in `~/.mobify--[hostname]` convention.
 *
 * @param origin - Raw cloud origin from ResolveConfigOptions
 * @returns Lowercased hostname, or undefined if origin is empty
 */
function originToHostname(origin: string | undefined): string | undefined {
  if (!origin) {
    return undefined;
  }
  const trimmed = origin.trim();
  if (!trimmed) {
    return undefined;
  }
  // Prepend a scheme so the URL parser can extract the hostname from a bare host.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    // Fall back to a best-effort strip of scheme/path/trailing slash.
    return trimmed
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
  }
}

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
 * An optional `mrt:<hostname>` account holds MRT credentials scoped to a
 * specific Managed Runtime cloud origin and overrides both.
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
 *
 * # Store an MRT API key scoped to a specific --cloud-origin (account is the hostname)
 * security add-generic-password -s 'b2c-cli' -a 'mrt:cloud-staging.mobify.com' \
 *   -w '{"mrtApiKey":"my-mrt-key"}' -U
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
   * 1. Load global defaults from the `*` account (if it exists)
   * 2. Determine instance: options.instance → *.defaultInstance → SFCC_KEYCHAIN_INSTANCE
   * 3. Load instance-specific config (if an instance was determined)
   * 4. Determine the MRT hostname: the normalized `options.cloudOrigin`, or — when
   *    no origin was provided — the default MRT hostname (`cloud.mobify.com`).
   *    Load the `mrt:<hostname>` account (if it exists).
   * 5. Merge with precedence (most-specific wins): origin > instance > global,
   *    applying credential-group protection so a credential pair never straddles
   *    two layers. Return the result (minus the `defaultInstance` meta-field).
   *
   * Specificity precedence: the `mrt:<hostname>` layer is the most specific. Note
   * that with no `--cloud-origin`, the *default* origin's entry (if present) still
   * participates — but only an existing `mrt:cloud.mobify.com` entry has any
   * effect; absent that entry, behavior is unchanged from instance/global only.
   *
   * @param options - Resolution options including instance and cloudOrigin
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

    // Step 4: Determine the MRT hostname. Use the explicit cloud origin when given;
    // otherwise fall back to the default MRT origin's hostname so a plain
    // `b2c mrt ...` (no --cloud-origin) still resolves an mrt:cloud.mobify.com entry.
    // Normalization means a single stored key resolves regardless of how the origin
    // was spelled (URL, bare host, trailing slash, case).
    const mrtHostname = originToHostname(options.cloudOrigin) ?? DEFAULT_MRT_HOSTNAME;
    const originAccount = `${MRT_ACCOUNT_PREFIX}${mrtHostname}`;
    const originConfig = getConfigFromKeychain(this.service, originAccount);

    if (originConfig) {
      locationParts.push(`keychain:${this.service}:${originAccount}`);
    }

    // If no account contributed anything, return undefined
    if (!globalConfig && !instanceConfig && !originConfig) {
      return undefined;
    }

    // Step 5: Merge layers most-specific first with credential-group protection.
    // Precedence: origin > instance > global.
    const merged = mergeLayersWithGroupProtection([originConfig, instanceConfig, globalConfig]);

    // Remove the defaultInstance meta-field from the result
    delete (merged as KeychainConfig).defaultInstance;

    return {
      config: merged,
      location: locationParts.join(','),
    };
  }
}
