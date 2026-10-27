/**
 * Auth-session store backed by the macOS Keychain.
 *
 * Holds the sessions the B2C CLI remembers after `b2c auth login`,
 * `b2c auth client`, and browser sign-in (access and refresh tokens),
 * instead of the CLI's default `auth-sessions.json` file.
 *
 * @module sessions/keychain-auth-session-backend
 */

import {spawnSync} from 'node:child_process';
import {deflateRawSync, inflateRawSync} from 'node:zlib';
import type {AuthSession, AuthSessionBackend} from '../types.js';

/** Keychain status for "item not found". */
const ERR_ITEM_NOT_FOUND = '-25300';

/**
 * Bytes of encoded session data per keychain item. `security -i` reads at most
 * about 4KB per command line and `-X` doubles the size (hex), so keep each
 * command comfortably below that.
 */
const CHUNK_SIZE = 1800;

/** Upper bound on chunks read, so a corrupted store cannot loop forever. */
const MAX_CHUNKS = 256;

/** Chunks looked up per `security -i` call when reading. */
const READ_BATCH = 16;

/**
 * How long reads are served from memory. Commands look sessions up several
 * times while starting, so this avoids a keychain read for each lookup, while
 * long-running hosts (MCP server, VS Code) still see sessions written by other
 * processes.
 */
const CACHE_TTL_MS = 5000;

interface SessionStore {
  version: 1;
  sessions: AuthSession[];
}

/**
 * Stores every session in one record, split across generic-password items
 * `chunk-0`, `chunk-1`, ... under a dedicated service (default
 * `b2c-cli.auth-sessions`).
 *
 * The record is deflated, base64-encoded, and chunked so that each write fits
 * through `security -i`. Writes go over stdin rather than command-line
 * arguments, so tokens never show up in the process list. Base64 is printable,
 * so `find-generic-password -w` returns each chunk as-is.
 *
 * Reads are cached briefly. Writes re-read the keychain first so they don't drop
 * sessions saved by another process, and are synchronous, so there is nothing
 * to flush.
 */
export class KeychainAuthSessionBackend implements AuthSessionBackend {
  private cache?: AuthSession[];
  private cachedAt = 0;
  /** Number of chunks currently in the keychain (known after the first read). */
  private storedChunks = 0;

  constructor(readonly service: string) {}

  find(clientId: string): AuthSession | null {
    return this.load().find((s) => s.clientId === clientId) ?? null;
  }

  save(session: AuthSession): void {
    const persisted: AuthSession = {...session, lastUsedAt: new Date().toISOString()};
    const sessions = this.load(true).filter((s) => s.clientId !== session.clientId);
    sessions.push(persisted);
    this.write(sessions);
  }

  delete(clientId: string): void {
    const sessions = this.load(true);
    const next = sessions.filter((s) => s.clientId !== clientId);
    if (next.length !== sessions.length) {
      this.write(next);
    }
  }

  list(): AuthSession[] {
    return [...this.load()];
  }

  clearAll(): void {
    this.load(true);
    this.deleteChunks(0, Math.max(this.storedChunks, 1));
    this.storedChunks = 0;
    this.cache = [];
    this.cachedAt = Date.now();
  }

  private load(fresh = false): AuthSession[] {
    if (!fresh && this.cache && Date.now() - this.cachedAt < CACHE_TTL_MS) return this.cache;

    const chunks: string[] = [];
    while (chunks.length < MAX_CHUNKS) {
      const batch = readChunks(this.service, chunks.length, READ_BATCH);
      chunks.push(...batch);
      if (batch.length < READ_BATCH) break;
    }
    this.storedChunks = chunks.length;
    this.cache = [];
    this.cachedAt = Date.now();

    if (chunks.length > 0) {
      try {
        const json = inflateRawSync(Buffer.from(chunks.join(''), 'base64')).toString('utf8');
        const data = JSON.parse(json) as Partial<SessionStore>;
        if (Array.isArray(data.sessions)) this.cache = data.sessions;
      } catch {
        // Unreadable store (for example, a write interrupted midway): start empty.
        // The next save overwrites it.
      }
    }
    return this.cache;
  }

  private write(sessions: AuthSession[]): void {
    const store: SessionStore = {version: 1, sessions};
    const encoded = deflateRawSync(Buffer.from(JSON.stringify(store), 'utf8')).toString('base64');
    const chunks: string[] = [];
    for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
      chunks.push(encoded.slice(i, i + CHUNK_SIZE));
    }

    const commands = chunks.map(
      (chunk, i) =>
        `add-generic-password -U -s ${quote(this.service)} -a ${chunkAccount(i)} ` +
        `-l ${quote(`${this.service} (B2C CLI auth sessions)`)} -X ${Buffer.from(chunk, 'utf8').toString('hex')}`,
    );
    runSecurityBatch(commands, {allowNotFound: false});

    if (this.storedChunks > chunks.length) {
      this.deleteChunks(chunks.length, this.storedChunks);
    }
    this.storedChunks = chunks.length;
    this.cache = sessions;
    this.cachedAt = Date.now();
  }

  private deleteChunks(from: number, to: number): void {
    const commands: string[] = [];
    for (let i = from; i < to; i++) {
      commands.push(`delete-generic-password -s ${quote(this.service)} -a ${chunkAccount(i)}`);
    }
    if (commands.length > 0) runSecurityBatch(commands, {allowNotFound: true});
  }
}

function chunkAccount(index: number): string {
  return `chunk-${index}`;
}

/**
 * Reads up to `count` chunks starting at `from` in one `security -i` call.
 * Each found item prints one line; missing items print nothing, so the result
 * holds the contiguous chunks that exist.
 */
function readChunks(service: string, from: number, count: number): string[] {
  const commands: string[] = [];
  for (let i = from; i < from + count; i++) {
    commands.push(`find-generic-password -s ${quote(service)} -a ${chunkAccount(i)} -w`);
  }
  const result = spawnSync('security', ['-i'], {input: commands.join('\n') + '\n', encoding: 'utf-8'});
  if (result.error) throw result.error;
  return result.stdout.split('\n').filter((line) => line.length > 0);
}

/**
 * Runs `security` commands in interactive mode, reading them from stdin so
 * secret data never appears in process arguments.
 */
function runSecurityBatch(commands: string[], options: {allowNotFound: boolean}): void {
  const result = spawnSync('security', ['-i'], {input: commands.join('\n') + '\n', encoding: 'utf-8'});
  if (result.error) throw result.error;
  if (result.status === 0) return;

  const failures = [...result.stderr.matchAll(/^(\S+): returned (-?\d+)$/gm)].filter(
    ([, , code]) => !(options.allowNotFound && code === ERR_ITEM_NOT_FOUND),
  );
  if (failures.length > 0 || !options.allowNotFound) {
    const detail = failures.map(([line]) => line).join('; ') || result.stderr.trim() || `exit code ${result.status}`;
    throw new Error(`Failed to update the macOS Keychain: ${detail}`);
  }
}

/** Quotes a value for `security -i`, which splits command lines on whitespace. */
function quote(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}
