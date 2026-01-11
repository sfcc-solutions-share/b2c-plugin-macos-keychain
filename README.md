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

### Keychain Entry Structure

| Field | Value |
|-------|-------|
| Service (`-s`) | `b2c-cli` (configurable via `SFCC_KEYCHAIN_SERVICE`) |
| Account (`-a`) | `*` for global defaults, or instance name |
| Password (`-w`) | JSON object with credentials |

### Supported JSON Fields

```json
{
  "defaultInstance": "staging",
  "username": "user@example.com",
  "password": "webdav-access-key",
  "clientId": "oauth-client-id",
  "clientSecret": "oauth-client-secret",
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
   - `--instance` CLI flag
   - `defaultInstance` from `*` config
   - `SFCC_KEYCHAIN_INSTANCE` environment variable
3. **Load instance-specific config** and merge (instance overrides global)
4. **Return merged config** to CLI

### Merge Behavior

Instance-specific values override global values at the field level:

```
* = {"clientId": "shared", "clientSecret": "shared-secret", "username": "default-user"}
staging = {"username": "staging-user", "password": "staging-pass"}

Result = {"clientId": "shared", "clientSecret": "shared-secret", "username": "staging-user", "password": "staging-pass"}
```

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
