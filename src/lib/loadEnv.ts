import fs from 'node:fs';
import path from 'node:path';

/** Minimal .env.local loader for CLI scripts. Never prints values and never overrides variables that are already set. */
export function loadEnvLocal(file = path.join(process.cwd(), '.env.local')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2]!.replace(/(^|\s+)#.*$/, '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v && process.env[m[1]!] === undefined) process.env[m[1]!] = v;
  }
}
