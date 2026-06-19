# b2c-plugin-macos-keychain

A plugin for the [B2C CLI](https://github.com/SalesforceCommerceCloud/b2c-developer-tooling) that loads credentials from the macOS Keychain.

This allows you to securely store B2C credentials without keeping them in files like `dw.json` or environment variables.

## Prerequisites

- [B2C CLI](https://github.com/SalesforceCommerceCloud/b2c-developer-tooling) installed
- macOS (this plugin only works on macOS)

## Installation

Install directly from GitHub:

```bash
b2c plugins install sfcc-solutions-share/b2c-plugin-macos-keychain

# Verify installation
b2c plugins
```

### Development Installation

For local development:

```bash
# Clone the repository
git clone https://github.com/sfcc-solutions-share/b2c-plugin-macos-keychain.git
cd b2c-plugin-macos-keychain

# Install dependencies and build
npm install
npm run build

# Link to B2C CLI
b2c plugins link .

# Verify installation
b2c plugins
```

## Storing Credentials

Credentials are stored as JSON blobs in the macOS Keychain using the `security` command.

### Global Defaults (`*` account)

Store shared credentials that apply to all instances:

```bash
security add-generic-password -s 'b2c-cli' -a '*' \
  -w '{"clientId":"shared-id","clientSecret":"shared-secret"}' -U
```

You can also set a default instance:

```bash
security add-generic-password -s 'b2c-cli' -a '*' \
  -w '{"clientId":"shared-id","clientSecret":"shared-secret","defaultInstance":"staging"}' -U
```

### Instance-Specific Credentials

Store credentials for a specific instance:

```bash
security add-generic-password -s 'b2c-cli' -a 'staging' \
  -w '{"username":"user@example.com","password":"my-webdav-key"}' -U
```

The `-U` flag updates the entry if it already exists.

### MRT Origin-Scoped Credentials

Managed Runtime (MRT) commands resolve their API key against a **cloud origin**
(`--cloud-origin`, `MRT_CLOUD_ORIGIN` / `SFCC_MRT_CLOUD_ORIGIN`, or `mrtOrigin`
in `dw.json`). You can store an MRT API key scoped to a specific origin in an
`mrt:<hostname>` account:

```bash
security add-generic-password -s 'b2c-cli' -a 'mrt:cloud-staging.mobify.com' \
  -w '{"mrtApiKey":"my-mrt-key"}' -U
```

```bash
b2c mrt push --cloud-origin https://cloud-staging.mobify.com
```

The account name is the **hostname only** — no scheme, no trailing slash. The
plugin normalizes whatever origin form is in play down to a hostname before the
lookup, so the key above resolves whether the command used
`--cloud-origin https://cloud-staging.mobify.com`,
`--cloud-origin cloud-staging.mobify.com`, or a `dw.json` `mrtOrigin`. This
mirrors the `~/.mobify--[hostname]` convention the CLI uses for its built-in MRT
credentials file.

> **Default origin:** when no origin is provided, the plugin falls back to the
> default MRT hostname `cloud.mobify.com`, so an `mrt:cloud.mobify.com` entry
> resolves for a plain `b2c mrt push` with no `--cloud-origin`. (The SDK applies
> the default origin only *after* resolution, so the plugin mirrors that default
> itself.) If no matching `mrt:<hostname>` entry exists, this lookup contributes
> nothing and resolution falls through to your instance and `*` entries as usual.

### Keychain Entry Structure

| Field | Value |
|-------|-------|
| Service (`-s`) | `b2c-cli` (configurable via `SFCC_KEYCHAIN_SERVICE`) |
| Account (`-a`) | `*` for global defaults, an instance name, or `mrt:<hostname>` for an MRT origin |
| Password (`-w`) | JSON object with credentials |

### Supported JSON Fields

```json
{
  "defaultInstance": "staging",
  "username": "user@example.com",
  "password": "webdav-access-key",
  "clientId": "oauth-client-id",
  "clientSecret": "oauth-client-secret",
  "slasClientId": "slas-client-id",
  "slasClientSecret": "slas-client-secret",
  "mrtApiKey": "....mrt-api-key",
  "hostname": "dev01-realm-customer.demandware.net",
  "codeVersion": "version1",
  "shortCode": "abcd1234"
}
```

Note: `defaultInstance` is only used in the `*` account to specify which instance to use when none is provided.

## Configuration Resolution

The plugin resolves configuration in this order:

1. **Load global defaults** from the `*` account (if exists)
2. **Determine instance** (in priority order):
   - `--instance`, `-i` CLI flag
   - `defaultInstance` from `*` config
   - `SFCC_KEYCHAIN_INSTANCE` environment variable
3. **Load instance-specific config** (if an instance was determined)
4. **Load MRT origin-scoped config** from `mrt:<hostname>`. The hostname is the
   normalized `--cloud-origin` (or `MRT_CLOUD_ORIGIN` / `dw.json` `mrtOrigin`); when
   **no origin is provided**, the default MRT hostname `cloud.mobify.com` is used,
   so a `mrt:cloud.mobify.com` entry resolves for plain `b2c mrt ...` commands. If
   no matching entry exists, this layer simply contributes nothing.
5. **Merge** the layers (see below) and **return** the result to the CLI

### Merge Behavior

Layers merge with precedence **global (`*`) < instance < MRT origin** — the
most-specific layer wins per field:

```
* = {"clientId": "shared", "clientSecret": "shared-secret", "username": "default-user"}
staging = {"username": "staging-user", "password": "staging-pass"}

Result = {"clientId": "shared", "clientSecret": "shared-secret", "username": "staging-user", "password": "staging-pass"}
```

The global `*` layer is **always** a base layer — a more-specific entry overrides
only the fields it defines, it does not replace `*` wholesale. This is what makes
the "shared OAuth in `*`, per-instance WebDAV credentials" pattern work.

When an MRT origin matches, its fields win over both:

```
* = {"clientId": "shared", "mrtApiKey": "global-mrt-key"}
mrt:cloud-staging.mobify.com = {"mrtApiKey": "staging-mrt-key"}

# with --cloud-origin https://cloud-staging.mobify.com
Result = {"clientId": "shared", "mrtApiKey": "staging-mrt-key"}
```

#### Credential-group protection

Credential **pairs** are kept whole — they never straddle two layers. The grouped
pairs are `clientId`+`clientSecret`, `username`+`password`, and
`slasClientId`+`slasClientSecret`. The most-specific layer that defines *any* field
of a pair owns the **whole** pair; a less-specific layer cannot supply the missing
half. This prevents an incoherent credential (e.g. a `clientId` from one entry glued
to a `clientSecret` from another), mirroring the protection the B2C SDK applies
across configuration sources.

```
* = {"clientId": "global-id", "clientSecret": "global-secret"}
staging = {"clientId": "staging-id"}          # only half the pair

# clientSecret is NOT borrowed from * — the pair stays within the staging layer
Result = {"clientId": "staging-id"}
```

Independent (non-paired) fields — `hostname`, `codeVersion`, `mrtApiKey`,
`shortCode`, etc. — always cascade field-by-field with most-specific winning.

## Usage Examples

### Shared OAuth + Instance Credentials

```bash
# Store shared OAuth (used by all instances)
security add-generic-password -s 'b2c-cli' -a '*' \
  -w '{"clientId":"my-client-id","clientSecret":"my-secret"}' -U

# Store instance-specific WebDAV credentials
security add-generic-password -s 'b2c-cli' -a 'staging' \
  -w '{"username":"user@example.com","password":"webdav-key"}' -U

# Use with explicit instance
b2c code deploy --instance staging
```

### Default Instance

```bash
# Store global config with default instance
security add-generic-password -s 'b2c-cli' -a '*' \
  -w '{"clientId":"my-client-id","clientSecret":"my-secret","defaultInstance":"staging"}' -U

# Store staging credentials
security add-generic-password -s 'b2c-cli' -a 'staging' \
  -w '{"username":"user@example.com","password":"webdav-key"}' -U

# No --instance needed, uses defaultInstance from *
b2c code deploy
```

### Global OAuth Only (works with dw.json)

```bash
# Store just OAuth credentials globally
security add-generic-password -s 'b2c-cli' -a '*' \
  -w '{"clientId":"my-client-id","clientSecret":"my-secret"}' -U

# dw.json provides hostname, username, password
# Keychain provides clientId, clientSecret
b2c code deploy
```

### Per-Origin MRT API Keys

```bash
# Store an MRT key for the staging cloud origin
security add-generic-password -s 'b2c-cli' -a 'mrt:cloud-staging.mobify.com' \
  -w '{"mrtApiKey":"staging-mrt-key"}' -U

# Store a different MRT key for production
security add-generic-password -s 'b2c-cli' -a 'mrt:cloud.mobify.com' \
  -w '{"mrtApiKey":"prod-mrt-key"}' -U

# The matching key is selected by --cloud-origin
b2c mrt push --cloud-origin https://cloud-staging.mobify.com   # uses staging-mrt-key
b2c mrt push --cloud-origin https://cloud.mobify.com           # uses prod-mrt-key
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SFCC_KEYCHAIN_SERVICE` | Service name in keychain | `b2c-cli` |
| `SFCC_KEYCHAIN_INSTANCE` | Fallback instance name | (none) |

## Managing Credentials

### View Stored Entry

```bash
# Show entry metadata (not the password)
security find-generic-password -s 'b2c-cli' -a 'staging'

# Retrieve the JSON blob
security find-generic-password -s 'b2c-cli' -a 'staging' -w

# View global defaults
security find-generic-password -s 'b2c-cli' -a '*' -w
```

### Update Credentials

Use the `-U` flag to update an existing entry:

```bash
security add-generic-password -s 'b2c-cli' -a 'staging' \
  -w '{"username":"new-user@example.com","password":"new-key"}' -U
```

### Delete Credentials

```bash
# Delete instance config
security delete-generic-password -s 'b2c-cli' -a 'staging'

# Delete global defaults
security delete-generic-password -s 'b2c-cli' -a '*'
```

## Configuration Priority

When this plugin is installed, configuration is resolved in this order:

1. CLI flags and environment variables (highest priority)
2. `dw.json` file
3. `~/.mobify` file
4. **macOS Keychain credentials** (this plugin, fills in missing credentials)

## Troubleshooting

### Enable Debug Logging

```bash
DEBUG='oclif:*' b2c code list --instance staging
```

### Verify Plugin is Loaded

```bash
b2c plugins
```

You should see `b2c-plugin-macos-keychain` in the list.

### Keychain Access Prompts

On first access, macOS may prompt you to allow the terminal application to access the keychain. Click "Always Allow" for a smoother experience.

### Check Credentials Exist

```bash
# This should output the JSON if found
security find-generic-password -s 'b2c-cli' -a 'staging' -w
```

If you get `security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.`, the credential hasn't been stored.

### Validate JSON Format

If credentials aren't loading, verify your JSON is valid:

```bash
security find-generic-password -s 'b2c-cli' -a 'staging' -w | jq .
```

## Security Considerations

- Credentials are stored securely by macOS (encrypted at rest)
- Access is controlled by the Keychain Access application
- The `-w` flag outputs the password to stdout - avoid in scripts that log output
- Consider adding the CLI to "Always Allow" in Keychain Access for smoother UX

## Related

- [B2C CLI Documentation](https://salesforcecommercecloud.github.io/b2c-developer-tooling/)
- [Creating Custom Plugins](https://salesforcecommercecloud.github.io/b2c-developer-tooling/guide/extending.html)
- [macOS Keychain Services](https://developer.apple.com/documentation/security/keychain_services)

## License

MIT
