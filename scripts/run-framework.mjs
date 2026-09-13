import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { readExecutionProfile } from './execution-profile.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const openaiDir = resolve(root, '.openai');
const hostingJson = resolve(openaiDir, 'hosting.json');
if (!existsSync(openaiDir)) mkdirSync(openaiDir, { recursive: true });
if (!existsSync(hostingJson)) writeFileSync(hostingJson, '{}\n');

const [command, ...args] = process.argv.slice(2);
if (!['dev', 'build'].includes(command)) throw new Error('Expected dev or build.');
const managedLinux = readExecutionProfile() === 'managed-linux';

if (managedLinux && command === 'build') {
  const result = spawnSync('bash', [fileURLToPath(new URL('./build-verified.sh', import.meta.url)), ...args], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// Import in this process so the preview owner retains its PID and signals.
const cli = new URL(
  managedLinux ? '../node_modules/vite/bin/vite.js' : '../node_modules/vinext/dist/cli.js',
  import.meta.url,
);
process.argv = [
  process.execPath,
  fileURLToPath(cli),
  command,
  ...(!managedLinux && command === 'dev' ? ['--port', '5173'] : []),
  ...args,
];
await import(cli.href);
