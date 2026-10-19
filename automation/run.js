// Daily run (GitHub Actions, or your PC with run-local.bat).
import { chromium } from 'playwright-core';
import { loadEnv, need } from '../lib/env.js';
import { loadStore, saveStore } from '../lib/store.js';
import { sendMessage, sendImage, tgUpload, esc } from '../lib/telegram.js';
import { runAccount } from './tasks.js';

loadEnv();
const ADMIN = need('ADMIN_ID');
const DEBUG = String(process.env.DEBUG).toLowerCase() === 'true';
const ONLY = (process.env.ACCOUNT || '').trim();
const SLUG = process.env.EVENT_SLUG || 'halloween';
const ITEM = process.env.ITEM_NAME || '1';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const ICON = { ok: '✅', done: '✅', claimed: '✅', skip: '⏭️', unknown: '⚠️', fail: '❌', error: '❌', not_ready: '⏳' };

function createLogger() {
  const shots = [];
  const files = [];
  return {
    shots,
    files,
    async shot(page, label) {
      try {
        shots.push({ label, buf: await page.screenshot({ fullPage: true, type: 'jpeg', quality: 60 }) });
      } catch {}
    },
    file(name, content) {
      files.push({ name, content });
    },
  };
}

async function report(name, result, log) {
  let text = `👤 <b>${esc(name)}</b>\n`;
  if (!result.loggedIn) {
    text += '🔑 سشن این اکانت منقضی شده یا لاگین نیست.\nروی کامپیوتر <code>login.bat</code> را برای همین اسم دوباره اجرا کنید.';
  }
  for (const s of result.steps) text += `${ICON[s.status] || '•'} ${esc(s.label)}: ${esc(s.note || s.status)}\n`;
  if (result.crash) text += `❌ خطا: ${esc(result.crash)}\n`;
  await sendMessage(ADMIN, text);

  const bad = !result.loggedIn || result.crash || result.steps.some((s) => ['error', 'unknown', 'fail'].includes(s.status));
  for (const s of log.shots.slice(0, 8)) await sendImage(ADMIN, s.buf, `${name} — ${s.label}`.slice(0, 1000)).catch(() => {});
  // Technical details: only in /debug runs or when something went wrong.
  if (DEBUG || bad) {
    const dump = log.files.map((f) => `===== ${f.name} =====\n${f.content}`).join('\n\n');
    if (dump) await tgUpload('sendDocument', { chat_id: ADMIN, caption: `${name}: جزئیات فنی برای عیب‌یابی` }, 'document', Buffer.from(dump), `${name}-debug.txt`).catch(() => {});
  }
}

async function main() {
  const { store } = await loadStore();
  const names = Object.keys(store.accounts).filter((n) => !ONLY || n === ONLY);
  if (!names.length) {
    await sendMessage(ADMIN, ONLY ? `اکانت «${esc(ONLY)}» پیدا نشد.` : 'هیچ اکانتی ثبت نشده. اول با login.bat اکانت‌ها را اضافه کنید.');
    return;
  }

  const day = new Date().toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran' });
  await sendMessage(ADMIN, `🎃 <b>اجرای OneState</b> — ${day}${DEBUG ? ' (عیب‌یابی)' : ''}\nاکانت‌ها: ${names.map(esc).join('، ')}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const updates = {};
  for (const name of names) {
    const acc = store.accounts[name];
    const log = createLogger();
    const context = await browser.newContext({
      storageState: acc.session,
      locale: 'en-US',
      userAgent: UA,
      viewport: { width: 1280, height: 1000 },
    });
    await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));

    let result;
    try {
      result = await runAccount(context, acc, { log, debug: DEBUG, slug: SLUG, itemName: ITEM });
    } catch (e) {
      result = { steps: [], loggedIn: true, crash: e.message };
    }

    const update = {
      lastRun: { at: new Date().toISOString(), loggedIn: result.loggedIn, steps: result.steps.map(({ label, status, note }) => ({ label, status, note })) },
      lastPurchaseDay: acc.lastPurchaseDay,
    };
    // Keep the refreshed cookies so the login lasts longer (not when the session is already dead).
    if (result.loggedIn) update.session = await context.storageState().catch(() => undefined);
    updates[name] = update;

    await context.close();
    await report(name, result, log).catch((e) => console.error('report failed', e));
  }
  await browser.close();

  // Re-read the store right before saving, so accounts added via the bot during the run are kept.
  const latest = await loadStore();
  for (const [name, u] of Object.entries(updates)) {
    const a = latest.store.accounts[name];
    if (!a) continue;
    a.lastRun = u.lastRun;
    a.lastPurchaseDay = u.lastPurchaseDay;
    if (u.session) a.session = u.session;
  }
  await saveStore(latest.store, latest.messageId);
}

main().catch(async (e) => {
  console.error(e);
  await sendMessage(ADMIN, '❌ اجرا با خطا متوقف شد:\n<code>' + esc(e.stack || e.message).slice(0, 3000) + '</code>').catch(() => {});
  process.exit(1);
});
