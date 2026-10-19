// Runs one step of one account in a real (serverless) Chrome, then starts the next step.
// Called by the bot (/run, /debug), the daily cron, and by itself.
import { waitUntil } from '@vercel/functions';
import { runChainStep } from '../automation/runner.js';
import { runKey, baseUrl } from '../lib/trigger.js';

export default async function handler(req, res) {
  const key = runKey();
  if (!key || req.headers.authorization !== `Bearer ${key}`) return res.status(401).send('unauthorized');
  const q = new URL(req.url, 'http://x').searchParams;
  const job = {
    i: Number(q.get('i') || 0),
    s: Number(q.get('s') || 0),
    r: q.get('r') || undefined,
    debug: q.get('debug') === 'true',
    account: q.get('account') || '',
    base: baseUrl(req),
  };
  // Answer right away; the work continues in the background.
  waitUntil(runChainStep(job));
  res.status(202).json({ started: true, i: job.i, s: job.s });
}
