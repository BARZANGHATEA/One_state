// Starts (or continues) a run by calling this app's own /api/run.
// Kept separate from the browser code so the bot webhook stays small.

export const runKey = () => (process.env.CRON_SECRET || process.env.WEBHOOK_SECRET || '').trim();

export function baseUrl(req) {
  return `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

export async function triggerRun(base, params = {}) {
  const q = new URLSearchParams(
    Object.entries({ i: 0, s: 0, ...params })
      .filter(([, v]) => v !== undefined && v !== '' && v !== false)
      .map(([k, v]) => [k, String(v)]),
  );
  const r = await fetch(`${base}/api/run?${q}`, { headers: { authorization: `Bearer ${runKey()}` } });
  if (!r.ok) throw new Error(`Could not start the run (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`);
}
