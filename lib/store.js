// All data lives in Telegram: one encrypted file, pinned in the store chat.
// Nothing is saved on Vercel or GitHub.
import crypto from 'node:crypto';
import { need } from './env.js';
import { tg, tgUpload, downloadFile } from './telegram.js';

const FILE_NAME = 'onestate-store.enc';
const MAGIC = Buffer.from('OS1');

const key = () => crypto.createHash('sha256').update(need('SESSION_KEY')).digest();
const storeChat = () => process.env.STORE_CHAT_ID || need('ADMIN_ID');

export function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), data]);
}

export function decrypt(buf) {
  if (!buf.subarray(0, 3).equals(MAGIC)) throw new Error('Store file is not valid');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(3, 15));
  d.setAuthTag(buf.subarray(15, 31));
  try {
    return JSON.parse(Buffer.concat([d.update(buf.subarray(31)), d.final()]).toString('utf8'));
  } catch {
    throw new Error('Cannot decrypt the store. SESSION_KEY must be the same everywhere (Vercel and your PC).');
  }
}

export async function loadStore() {
  const chat = await tg('getChat', { chat_id: storeChat() });
  const pinned = chat.pinned_message;
  if (!pinned) return { store: { accounts: {} }, messageId: null };
  if (pinned.document?.file_name !== FILE_NAME) {
    throw new Error('The pinned message in the store chat is not the bot\'s store file. Unpin it and try again.');
  }
  return { store: decrypt(await downloadFile(pinned.document.file_id)), messageId: pinned.message_id };
}

export async function saveStore(store, oldMessageId) {
  store.updatedAt = new Date().toISOString();
  const chat_id = storeChat();
  const msg = await tgUpload(
    'sendDocument',
    { chat_id, disable_notification: true, caption: '🔒 فایل ذخیره‌ی ربات (رمزنگاری‌شده). این پیام را حذف یا آنپین نکنید.' },
    'document',
    encrypt(store),
    FILE_NAME,
  );
  await tg('pinChatMessage', { chat_id, message_id: msg.message_id, disable_notification: true });
  if (oldMessageId && oldMessageId !== msg.message_id) {
    await tg('unpinChatMessage', { chat_id, message_id: oldMessageId }).catch(() => {});
    await tg('deleteMessage', { chat_id, message_id: oldMessageId }).catch(() => {});
  }
  return msg.message_id;
}

// Cleans a session so Playwright accepts it. Works with Playwright storageState JSON,
// Cookie-Editor / EditThisCookie exports, and plain cookie lists.
const SAME_SITE = { strict: 'Strict', lax: 'Lax', none: 'None', no_restriction: 'None' };

function cleanCookie(c) {
  if (!c || !c.name || !(c.domain || c.url)) return null;
  const secure = !!c.secure;
  let sameSite = SAME_SITE[String(c.sameSite ?? '').toLowerCase()] || 'Lax';
  if (sameSite === 'None' && !secure) sameSite = 'Lax';
  const exp = Number(c.expires ?? c.expirationDate ?? -1);
  const out = {
    name: String(c.name),
    value: String(c.value ?? ''),
    path: c.path || '/',
    expires: Number.isFinite(exp) && exp > 0 ? Math.floor(exp) : -1,
    httpOnly: !!c.httpOnly,
    secure,
    sameSite,
  };
  if (c.domain) out.domain = String(c.domain);
  else out.url = String(c.url);
  return out;
}

export function sanitizeSession(session) {
  const cookies = (session?.cookies || []).map(cleanCookie).filter(Boolean);
  const origins = (session?.origins || [])
    .filter((o) => o && o.origin)
    .map((o) => ({
      origin: String(o.origin),
      localStorage: (o.localStorage || []).filter((x) => x && x.name != null).map((x) => ({ name: String(x.name), value: String(x.value ?? '') })),
    }));
  return { cookies, origins };
}

export function normalizeSession(json) {
  if (json && Array.isArray(json.cookies)) return sanitizeSession(json);
  if (Array.isArray(json)) return sanitizeSession({ cookies: json, origins: [] });
  throw new Error('فرمت فایل سشن شناخته نشد.');
}
