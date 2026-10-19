import fs from 'node:fs';
import path from 'node:path';

// Loads KEY=VALUE lines from .env (used on your PC; Vercel and GitHub use their own settings).
export function loadEnv(file = '.env') {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

export function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing setting: ${name}`);
  return v;
}
