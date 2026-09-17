import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * Boot-contract tests: these spawn the real server entry (tsx + server.ts),
 * because both contracts live at module/process level where app.inject()
 * can't reach — env fail-fast runs during import, and signal handling is
 * the entry script's own wiring.
 */

const apiDir = fileURLToPath(new URL('..', import.meta.url));
const repoEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));

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
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const exited = new Promise<BootResult>((resolvePromise) => {
    child.once('exit', (code, signal) => resolvePromise({ code, signal, output }));
  });

  const waitForOutput = (needle: string, timeoutMs = 15_000) =>
    new Promise<void>((resolvePromise, reject) => {
      const started = Date.now();
      const poll = setInterval(() => {
        if (output.includes(needle)) {
          clearInterval(poll);
          resolvePromise();
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(poll);
          reject(new Error(`timed out waiting for ${JSON.stringify(needle)} in:\n${output}`));
        }
      }, 50);
    });

  return { child, exited, waitForOutput };
}

const testPort = () => String(20_000 + Math.floor(Math.random() * 20_000));

describe('boot contracts', () => {
  it('a broken .env fails the boot with the real error surfaced', async () => {
    // Runs against the actual repo-root .env path, so it must not clobber a
    // developer's real file; CI never has one.
    if (existsSync(repoEnvPath)) return;

    mkdirSync(repoEnvPath);
    try {
      const { exited } = bootServer({ PORT: testPort(), HOST: '127.0.0.1' });
      const result = await exited;
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('EISDIR');
    } finally {
      rmdirSync(repoEnvPath);
    }
  }, 30_000);

  it('SIGINT then SIGTERM shuts down once, cleanly', async () => {
    const { child, exited, waitForOutput } = bootServer({
      PORT: testPort(),
      HOST: '127.0.0.1',
    });
    await waitForOutput('Server listening');
    child.kill('SIGINT');
    child.kill('SIGTERM');
    const result = await exited;

    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    const shutdownLogs = result.output.match(/"msg":"shutting down"/g) ?? [];
    expect(shutdownLogs).toHaveLength(1);
  }, 30_000);
});
