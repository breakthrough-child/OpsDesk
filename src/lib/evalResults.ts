import fs from 'node:fs';
import path from 'node:path';

const root = () => path.join(process.cwd(), 'evals', 'results');

export interface RunDir { dir: string; summary: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any

export function listRuns(): RunDir[] {
  if (!fs.existsSync(root())) return [];
  return fs.readdirSync(root()).sort().reverse().flatMap((dir) => {
    const f = path.join(root(), dir, 'summary.json');
    if (!fs.existsSync(f)) return [];
    try { return [{ dir, summary: JSON.parse(fs.readFileSync(f, 'utf8')) }]; } catch { return []; }
  });
}
