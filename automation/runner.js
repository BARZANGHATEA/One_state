// Shared run logic: browser launch, reports, saving results.
// Used by api/run.js (Vercel, one step per call) and automation/run.js (your PC, everything at once).
import { chromium } from 'playwright-core';
import { need } from '../lib/env.js';
import { loadStore, saveStore } from '../lib/store.js';
import { sendMessage, sendImage, tgUpload, esc } from '../lib/telegram.js';
import { triggerRun } from '../lib/trigger.js';
import { STEPS, STEP_LABELS, runAccountStep } from './tasks.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const ICON = { ok: '✅', done: '✅', claimed: '✅', skip: '⏭️', unknown: '⚠️', fail: '❌', error: '❌', not_ready: '⏳' };
export const settings = () => ({
  slug: process.env.EVENT_SLUG || 'halloween',
  itemName: process.env.ITEM_NAME || '1',
});
const admin = () => need('ADMIN_ID');

export async function launchBrowser() {
  if (process.env.VERCEL) {
    const { default: Chromium } = await import('@sparticuz/chromium');
    try {
      Chromium.setGraphicsMode = false;
    } catch {}
    return chromium.launch({ executablePath: await Chromium.executablePath(), args: Chromium.args, headless: true });
  }
  return chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

export async function newContext(browser, acc) {
  const context = await browser.newContext({
    storageState: acc.session,
    locale: 'en-US',
    userAgent: UA,
    viewport: { width: 1280, height: 1000 },
  });
  await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
  // Videos and fonts are not needed; skipping them saves memory and time.
  await context.route('**/*', (route) =>
    ['media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue(),
  );
  return context;
}

export function createLogger() {
  const shots = [];
  const files = [];
  return {
    shots,
    files,
    async shot(page, label) {
      try {
        shots.push({ label, buf: await page.screenshot({ fullPage: true, type: 'jpeg', quality: 55 }) });
      } catch {}
    },
    file(name, content) {
      files.push({ name, content });
    },
  };
}

const isBad = (steps) => steps.some((s) => ['error', 'unknown', 'fail'].includes(s.status));

// Screenshots + technical file (only in debug mode or when something went wrong).
export async function sendDetails(name, log, { debug, steps, loggedIn }) {
  for (const s of log.shots.slice(0, 6)) await sendImage(admin(), s.buf, `${name} — ${s.label}`.slice(0, 1000)).catch(() => {});
  if (debug || isBad(steps) || !loggedIn) {
    const dump = log.files.map((f) => `===== ${f.name} =====\n${f.content}`).join('\n\n');
    if (dump) {
      await tgUpload('sendDocument', { chat_id: admin(), caption: `${name}: جزئیات فنی برای عیب‌یابی` }, 'document', Buffer.from(dump), `${name}-debug.txt`).catch(() => {});
    }
  }
}

export async function sendSummary(name, result) {
  let text = `👤 <b>${esc(name)}</b>\n`;
  if (!result.loggedIn) {
    text += '🔑 سشن این اکانت منقضی شده یا لاگین نیست.\nروی کامپیوتر <code>login.bat</code> را برای همین اسم دوباره اجرا کنید.\n';
  }
  for (const s of result.steps) text += `${ICON[s.status] || '•'} ${esc(s.label)}: ${esc(s.note || s.status)}\n`;
  await sendMessage(admin(), text);
}

// Re-read the store right before saving, so changes made meanwhile (e.g. /add) are kept.
export async function saveAccountUpdate(name, update) {
  const latest = await loadStore();
  const a = latest.store.accounts[name];
  if (!a) return;
  a.lastRun = update.lastRun;
  if (update.lastPurchaseDay) a.lastPurchaseDay = update.lastPurchaseDay;
  if (update.session) a.session = update.session;
  await saveStore(latest.store, latest.messageId);
}

export async function sendHeader(names, debug) {
  const day = new Date().toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran' });
  await sendMessage(admin(), `🎃 <b>اجرای OneState</b> — ${day}${debug ? ' (عیب‌یابی)' : ''}\nاکانت‌ها: ${names.map(esc).join('، ')}`);
}

const compact = (steps) => steps.map(({ label, status, note }) => ({ label, status, note }));
const pack = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unpack = (s) => (s ? JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) : null);

// One call = one step of one account. At the end it starts the next call.
export async function runChainStep({ i = 0, s = 0, r, debug = false, account = '', base }) {
  try {
    const { store } = await loadStore();
    const names = Object.keys(store.accounts).filter((n) => !account || n === account);
    if (!names.length) {
      if (i === 0 && s === 0) {
        await sendMessage(admin(), account ? `اکانت «${esc(account)}» پیدا نشد.` : 'هیچ اکانتی ثبت نشده. اول با login.bat اکانت‌ها را اضافه کنید.');
      }
      return;
    }
    if (i >= names.length) return;
    if (i === 0 && s === 0) await sendHeader(names, debug);

    const name = names[i];
    const acc = store.accounts[name];
    const stepName = STEPS[s];
    const prev = unpack(r) || { steps: [], loggedIn: true };
    const log = createLogger();

    let browser;
    let context;
    let res;
    try {
      browser = await launchBrowser();
      context = await newContext(browser, acc);
      res = await runAccountStep(context, acc, stepName, { log, debug, ...settings() });
    } catch (e) {
      res = { steps: [{ label: STEP_LABELS[stepName], status: 'error', note: String(e.message).split('\n')[0].slice(0, 300) }], loggedIn: true };
    }

    const merged = { steps: [...prev.steps, ...compact(res.steps)], loggedIn: prev.loggedIn && res.loggedIn };
    await sendDetails(name, log, { debug, steps: compact(res.steps), loggedIn: res.loggedIn });

    const accountDone = s >= STEPS.length - 1 || !res.loggedIn;
    let next;
    if (accountDone) {
      const session = merged.loggedIn && context ? await context.storageState().catch(() => undefined) : undefined;
      await browser?.close().catch(() => {});
      await sendSummary(name, merged);
      await saveAccountUpdate(name, {
        lastRun: { at: new Date().toISOString(), loggedIn: merged.loggedIn, steps: merged.steps },
        lastPurchaseDay: acc.lastPurchaseDay,
        session,
      });
      next = { i: i + 1, s: 0 };
    } else {
      await browser?.close().catch(() => {});
      next = { i, s: s + 1, r: pack(merged) };
    }

    if (next.i < names.length) await triggerRun(base, { ...next, debug, account });
    else await sendMessage(admin(), '🏁 اجرا برای همه‌ی اکانت‌ها تمام شد.');
  } catch (e) {
    console.error(e);
    await sendMessage(admin(), '❌ اجرا با خطا متوقف شد:\n<code>' + esc(e.stack || e.message).slice(0, 3000) + '</code>').catch(() => {});
  }
}
