import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { testEnvVars } from './helpers/env.js';

/*
 * Boot-contract integration tests: these spawn the real server entry
 * (tsx + server.ts), because both contracts live at module/process level
 * where app.inject() can't reach — env fail-fast runs during import, and
 * signal wiring belongs to the entry script. The guard/deadline internals
 * are pinned by the shutdown.test.ts unit tests; these prove the process
 * end-to-end.
 */

const apiDir = fileURLToPath(new URL('..', import.meta.url));

const liveChildren = new Set<ChildProcess>();
afterEach(() => {
  for (const child of liveChildren) {
    child.kill('SIGKILL');
  }
  liveChildren.clear();
});

interface BootResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}

function bootServer(extraEnv: Record<string, string>): {
  child: ChildProcess;
  exited: Promise<BootResult>;
  waitForOutput: (needle: string, timeoutMs?: number) => Promise<void>;
} {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: apiDir,
    // testEnvVars satisfies the required auth config so the server can boot; the
    // broken-.env cases fail at dotenv read, before the schema is even checked.
    env: { ...process.env, ...testEnvVars, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  liveChildren.add(child);

  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));

  // 'close', not 'exit': close also waits for the stdio pipes to drain, so
  // `output` is complete when the promise settles.
  const exited = new Promise<BootResult>((resolvePromise) => {
    child.once('close', (code, signal) => {
      liveChildren.delete(child);
      resolvePromise({ code, signal, output });
    });
  });

  // Resolves when the needle appears; rejects promptly if the process exits
  // first (e.g. a bind failure) instead of polling out the clock.
  const waitForOutput = (needle: string, timeoutMs = 15_000) =>
    new Promise<void>((resolvePromise, reject) => {
      const started = Date.now();
      const poll = setInterval(() => {
        if (output.includes(needle)) {
          clearInterval(poll);
          resolvePromise();
        } else if (child.exitCode !== null || Date.now() - started > timeoutMs) {
          clearInterval(poll);
          reject(new Error(`never saw ${JSON.stringify(needle)}; output so far:\n${output}`));
        }
      }, 50);
    });

  return { child, exited, waitForOutput };
}

/** Awaits exit with a bound; on timeout kills the child so nothing leaks. */
async function exitWithin(
  child: ChildProcess,
  exited: Promise<BootResult>,
  ms: number,
): Promise<BootResult> {
  const timer = setTimeout(() => child.kill('SIGKILL'), ms);
  const result = await exited;
  clearTimeout(timer);
  if (result.signal === 'SIGKILL') {
    throw new Error(`process had to be SIGKILLed after ${ms}ms; output:\n${result.output}`);
  }
  return result;
}

describe('boot contracts', () => {
  it('a broken .env fails the boot with the real error surfaced', async () => {
    // Point dotenv at a *directory* via its own DOTENV_CONFIG_PATH convention:
    // an EISDIR read failure, with no repo files touched.
    const scratch = mkdtempSync(join(tmpdir(), 'bali-env-'));
    try {
      const { child, exited } = bootServer({
        DOTENV_CONFIG_PATH: scratch,
        PORT: '0',
        HOST: '127.0.0.1',
      });
      const result = await exitWithin(child, exited, 20_000);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('EISDIR');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 30_000);

  it('a missing explicitly-pointed-at .env fails the boot', async () => {
    // DOTENV_CONFIG_PATH names a file that does not exist: ENOENT, which a
    // missing *default* .env tolerates but an explicit path must not.
    const scratch = mkdtempSync(join(tmpdir(), 'bali-env-'));
    try {
      const { child, exited } = bootServer({
        DOTENV_CONFIG_PATH: join(scratch, 'nope.env'),
        PORT: '0',
        HOST: '127.0.0.1',
      });
      const result = await exitWithin(child, exited, 20_000);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('ENOENT');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 30_000);

  // Windows has no POSIX signals: Node's kill() there ends the child at once whatever the signal,
  // as SIGKILL would, so the graceful shutdown this checks never runs. Skipped on Windows alone;
  // CI's Linux runners run it as before.
  it.skipIf(process.platform === 'win32')(
    'SIGINT then SIGTERM shuts down once, cleanly',
    async () => {
      // PORT=0 lets the OS pick a free port — no collision window.
      const { child, exited, waitForOutput } = bootServer({ PORT: '0', HOST: '127.0.0.1' });
      await waitForOutput('Server listening');
      child.kill('SIGINT');
      child.kill('SIGTERM');
      const result = await exitWithin(child, exited, 20_000);

      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
      const shutdownLogs = result.output.match(/"msg":"shutting down"/g) ?? [];
      expect(shutdownLogs).toHaveLength(1);
      // The process entry starts the minute sweep (A15) — the one line that
      // fixes sessions ending late; sweep.test.ts pins what the ticker does.
      expect(result.output).toContain('"msg":"sweeping every minute"');
      // A deploy names no pool size: postgres.js's own 10 (DECISIONS 2026-10-22).
      expect(result.output).toContain('"msg":"database pool: 10 connections"');
    },
    30_000,
  );

  it('ignores PGMAX and a max in DATABASE_URL, keeping its own 10 connections, and says so without the URL', async () => {
    // Read as text, either would make a deploy's pool one connection (DECISIONS 2026-10-22). The
    // URL's parts are made afresh, so none is in this file's text.
    const part = randomBytes(8).toString('hex');
    const url = `postgresql://user_${part}:pw_${part}@db-${part}.example.invalid:5432/railway?max=20`;
    const { child, exited, waitForOutput } = bootServer({
      PORT: '0',
      HOST: '127.0.0.1',
      PGMAX: '20',
      DATABASE_URL: url,
    });
    await waitForOutput('Server listening');
    child.kill('SIGKILL');
    const { output } = await exited;

    const said = output
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as { level: number; msg: string; connections?: number })
      .filter((line) => line.connections !== undefined);
    // One line says the pool, once: a warning naming both, the pool still 10.
    expect(said).toEqual([
      expect.objectContaining({
        level: 40,
        connections: 10,
        msg: 'PGMAX and the max parameter in DATABASE_URL are ignored: the API sizes its own database pool, 10 connections (docs/DECISIONS.md, 2026-10-22)',
      }),
    ]);
    expect(output).not.toContain(part);
  }, 30_000);
});
