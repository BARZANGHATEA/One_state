// Open once in the browser after deploying:
//   https://YOUR-APP.vercel.app/api/setup?key=WEBHOOK_SECRET
// It connects Telegram to this app and sets the bot's command menu.
import { tg } from '../lib/telegram.js';

export default async function handler(req, res) {
  const secret = process.env.WEBHOOK_SECRET;
  const key = new URL(req.url, 'http://x').searchParams.get('key');
  if (!secret || key !== secret) return res.status(401).send('Add ?key=WEBHOOK_SECRET to the address.');
  try {
    const url = `https://${req.headers['x-forwarded-host'] || req.headers.host}/api/telegram`;
    await tg('setWebhook', { url, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true });
    await tg('setMyCommands', {
      commands: [
        { command: 'accounts', description: 'لیست اکانت‌ها و آخرین نتیجه' },
        { command: 'run', description: 'اجرای همین الان' },
        { command: 'debug', description: 'اجرا با اسکرین‌شات' },
        { command: 'remove', description: 'حذف اکانت' },
        { command: 'help', description: 'راهنما' },
      ],
    });
    const info = await tg('getWebhookInfo');
    res.status(200).send(`✅ Webhook set: ${info.url}\nNow send /start to your bot in Telegram.`);
  } catch (e) {
    res.status(500).send('❌ ' + e.message);
  }
}
