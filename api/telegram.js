// Telegram webhook (runs on Vercel).
import { tg, sendMessage, downloadFile, esc } from '../lib/telegram.js';
import { loadStore, saveStore, normalizeSession } from '../lib/store.js';
import { dispatchRun } from '../lib/github.js';

const HELP = `🎃 <b>ربات OneState</b>

<b>دستورها</b>
/accounts — لیست اکانت‌ها و نتیجه‌ی آخرین اجرا
/run — اجرای همین الان برای همه‌ی اکانت‌ها
/run نام — اجرا فقط برای یک اکانت
/debug — اجرا با اسکرین‌شات از هر مرحله (برای عیب‌یابی)
/remove نام — حذف یک اکانت
/myid — نمایش آیدی عددی شما

<b>اضافه کردن اکانت</b>
روش اصلی: روی کامپیوتر فایل <code>login.bat</code> را اجرا کنید (یک بار برای هر اکانت).
روش دوم: فایل JSON سشن را همین‌جا بفرستید و در کپشن بنویسید:
<code>/add نام_اکانت</code>

ربات هر روز خودکار اجرا می‌شود و گزارش را همین‌جا می‌فرستد.`;

const ICON = { ok: '✅', done: '✅', claimed: '✅', skip: '⏭️', unknown: '⚠️', fail: '❌', error: '❌', not_ready: '⏳' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OneState bot is running.');
  const secret = (process.env.WEBHOOK_SECRET || '').trim();
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) return res.status(401).send('unauthorized');

  const update = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const m = update.message;
  try {
    if (m) await handle(m);
  } catch (e) {
    console.error(e);
    if (m && isAdmin(m)) await sendMessage(m.chat.id, '❌ ' + esc(e.message)).catch(() => {});
  }
  res.status(200).send('ok'); // always 200, otherwise Telegram keeps retrying
}

const isAdmin = (m) => String(m.from?.id) === String(process.env.ADMIN_ID);

async function handle(m) {
  const text = (m.text || m.caption || '').trim();
  const [first = '', ...rest] = text.split(/\s+/);
  const cmd = first.split('@')[0].toLowerCase();
  const arg = rest.join(' ').trim();

  if (cmd === '/myid') return sendMessage(m.chat.id, `آیدی عددی شما: <code>${m.from.id}</code>`);
  if (!isAdmin(m)) return sendMessage(m.chat.id, 'این ربات خصوصی است.');

  if (m.document) {
    if (cmd !== '/add') return sendMessage(m.chat.id, 'برای ثبت سشن، در کپشن فایل بنویسید: <code>/add نام_اکانت</code>');
    return addAccount(m, arg);
  }

  switch (cmd) {
    case '/start':
    case '/help':
      return sendMessage(m.chat.id, HELP);
    case '/accounts':
      return listAccounts(m);
    case '/remove':
      return removeAccount(m, arg);
    case '/run':
    case '/debug': {
      await dispatchRun({ debug: cmd === '/debug', account: arg });
      return sendMessage(
        m.chat.id,
        `▶️ اجرا${cmd === '/debug' ? ' (حالت عیب‌یابی)' : ''} شروع شد${arg ? ` برای «${esc(arg)}»` : ''}. گزارش تا ۳–۵ دقیقه‌ی دیگر می‌رسد.`,
      );
    }
    default:
      return sendMessage(m.chat.id, 'دستور ناشناخته. /help را بزنید.');
  }
}

function validName(name) {
  return /^[^\s/]{1,32}$/.test(name);
}

async function addAccount(m, name) {
  if (!validName(name)) return sendMessage(m.chat.id, 'نام اکانت را در کپشن بنویسید (بدون فاصله). مثال: <code>/add acc1</code>');
  if (m.document.file_size > 2_000_000) return sendMessage(m.chat.id, 'فایل خیلی بزرگ است.');
  let session;
  try {
    session = normalizeSession(JSON.parse((await downloadFile(m.document.file_id)).toString('utf8')));
  } catch (e) {
    return sendMessage(m.chat.id, '❌ فایل معتبر نیست: ' + esc(e.message));
  }
  const siteCookies = session.cookies.filter((c) => /onestate/i.test(c.domain || ''));
  const { store, messageId } = await loadStore();
  const old = store.accounts[name] || {};
  store.accounts[name] = { ...old, session, addedAt: new Date().toISOString(), source: 'telegram' };
  await saveStore(store, messageId);
  // Remove the raw (unencrypted) session file from the chat.
  await tg('deleteMessage', { chat_id: m.chat.id, message_id: m.message_id }).catch(() => {});
  return sendMessage(
    m.chat.id,
    `✅ اکانت «${esc(name)}» ذخیره شد (${siteCookies.length} کوکی OneState).` +
      (siteCookies.length ? '' : '\n⚠️ هیچ کوکی‌ای از onestate.com در فایل نبود؛ احتمالاً سشن کار نمی‌کند.') +
      '\nبرای تست: <code>/run ' + esc(name) + '</code>',
  );
}

async function removeAccount(m, name) {
  const { store, messageId } = await loadStore();
  if (!store.accounts[name]) return sendMessage(m.chat.id, `اکانتی با نام «${esc(name)}» نیست.`);
  delete store.accounts[name];
  await saveStore(store, messageId);
  return sendMessage(m.chat.id, `🗑 اکانت «${esc(name)}» حذف شد.`);
}

async function listAccounts(m) {
  const { store } = await loadStore();
  const names = Object.keys(store.accounts);
  if (!names.length) return sendMessage(m.chat.id, 'هنوز اکانتی ثبت نشده. /help را ببینید.');
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }) : '—');
  const lines = names.map((n) => {
    const a = store.accounts[n];
    const last = a.lastRun;
    let s = `👤 <b>${esc(n)}</b>\n   ثبت: ${fmt(a.addedAt)}`;
    if (last) {
      s += `\n   آخرین اجرا: ${fmt(last.at)}`;
      for (const st of last.steps || []) s += `\n   ${ICON[st.status] || '•'} ${esc(st.label)}: ${esc(st.note || st.status)}`;
    }
    return s;
  });
  return sendMessage(m.chat.id, lines.join('\n\n'));
}
