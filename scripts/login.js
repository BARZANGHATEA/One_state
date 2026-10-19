// One-time login for an account, on your own PC.
// Opens your real Chrome (so Google / Discord login works), you log in by hand,
// then the session is encrypted and sent to your Telegram bot.
//
//   node scripts/login.js acc1
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { chromium } from 'playwright-core';
import { loadEnv, need } from '../lib/env.js';
import { loadStore, saveStore } from '../lib/store.js';
import { sendMessage, esc } from '../lib/telegram.js';

loadEnv();
const SITE = 'https://onestate.com/calendar';
// Cookies of the login providers are NOT uploaded — only what OneState itself needs.
const THIRD_PARTY = /(google|gstatic|youtube|doubleclick|discord|facebook|apple\.com|microsoftonline|live\.com|yandex|vk\.com|tiktok|twitter|x\.com)/i;

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome یا Edge پیدا نشد. مسیر chrome.exe را در فایل .env به شکل CHROME_PATH=... بنویسید.');
  return found;
}

async function connect(port) {
  for (let i = 0; i < 30; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('اتصال به مرورگر برقرار نشد. همه‌ی پنجره‌های همین پروفایل را ببندید و دوباره امتحان کنید.');
}

async function main() {
  need('BOT_TOKEN');
  need('ADMIN_ID');
  need('SESSION_KEY');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let name = (process.argv[2] || '').trim();
  if (!name) name = (await rl.question('نام اکانت (مثلا acc1): ')).trim();
  if (!/^[^\s/]{1,32}$/.test(name)) throw new Error('نام اکانت نباید فاصله داشته باشد.');

  const profile = path.resolve('profiles', name); // each account gets its own Chrome profile on your PC
  fs.mkdirSync(profile, { recursive: true });
  const port = 9300 + Math.floor(Math.random() * 600);
  const chrome = spawn(
    findChrome(),
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--new-window', SITE],
    { stdio: 'ignore', detached: false },
  );

  console.log(`\n🌐 یک پنجره‌ی Chrome برای اکانت «${name}» باز شد.`);
  console.log('   1) در سایت OneState با همین اکانت لاگین کنید (ایمیل، گوگل یا دیسکورد).');
  console.log('   2) مطمئن شوید صفحه‌ی تقویم با اکانت شما باز است.');
  await rl.question('   3) بعد اینجا Enter بزنید... ');
  rl.close();

  const browser = await connect(port);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => p.url().includes('onestate.com'));
  if (!page) page = await ctx.newPage();
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  const state = await ctx.storageState();
  const origin = new URL(page.url()).origin;
  const ls = await page.evaluate(() => Object.entries(localStorage).map(([name, value]) => ({ name, value })));
  const session = {
    cookies: state.cookies.filter((c) => !THIRD_PARTY.test(c.domain)),
    origins: [...(state.origins || []).filter((o) => /onestate/i.test(o.origin) && o.origin !== origin), { origin, localStorage: ls }],
  };
  const siteCookies = session.cookies.filter((c) => /onestate/i.test(c.domain)).length;
  console.log(`\n🍪 ${siteCookies} کوکی OneState و ${ls.length} مقدار localStorage گرفته شد.`);
  if (!siteCookies && !ls.length) console.log('⚠️ چیزی از سایت گرفته نشد؛ احتمالاً لاگین کامل نشده بود.');

  await browser.close().catch(() => {});
  chrome.kill();

  console.log('⬆️  در حال ارسال به ربات تلگرام...');
  const { store, messageId } = await loadStore();
  const old = store.accounts[name] || {};
  store.accounts[name] = { ...old, session, addedAt: new Date().toISOString(), source: `login-script (${os.hostname()})` };
  await saveStore(store, messageId);
  await sendMessage(need('ADMIN_ID'), `✅ اکانت «${esc(name)}» از کامپیوتر ثبت شد.\nبرای تست: <code>/run ${esc(name)}</code>`);
  console.log(`✅ تمام! اکانت «${name}» ذخیره شد. حالا در تلگرام /run ${name} را بزنید.\n`);
}

main().catch((e) => {
  console.error('\n❌ ' + e.message);
  process.exit(1);
});
