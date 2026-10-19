import { need } from './env.js';

const api = () => `https://api.telegram.org/bot${need('BOT_TOKEN')}`;

export async function tg(method, params = {}) {
  const r = await fetch(`${api()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result;
}

// Upload a file (document / photo) from a Buffer.
export async function tgUpload(method, fields, fileField, buffer, filename) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  fd.append(fileField, new Blob([buffer]), filename);
  const r = await fetch(`${api()}/${method}`, { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result;
}

export async function downloadFile(fileId) {
  const f = await tg('getFile', { file_id: fileId });
  const r = await fetch(`https://api.telegram.org/file/bot${need('BOT_TOKEN')}/${f.file_path}`);
  if (!r.ok) throw new Error(`Telegram download failed: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function sendMessage(chat_id, text, extra = {}) {
  return tg('sendMessage', {
    chat_id,
    text: text.length > 4000 ? text.slice(0, 4000) + '…' : text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

export async function sendImage(chat_id, buffer, caption) {
  try {
    return await tgUpload('sendPhoto', { chat_id, caption }, 'photo', buffer, 'screen.jpg');
  } catch {
    // Very tall screenshots are rejected as photos; send them as a file instead.
    return tgUpload('sendDocument', { chat_id, caption }, 'document', buffer, 'screen.jpg');
  }
}
