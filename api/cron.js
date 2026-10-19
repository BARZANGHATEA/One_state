// Called once a day by Vercel Cron (see vercel.json). Starts the GitHub Actions run.
import { dispatchRun } from '../lib/github.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).send('unauthorized');
  try {
    await dispatchRun({});
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
