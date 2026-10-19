// Run everything on your own PC (run-local.bat). On Vercel, api/run.js is used instead.
import { loadEnv } from '../lib/env.js';
loadEnv();
const { loadStore } = await import('../lib/store.js');
const { sendMessage, esc } = await import('../lib/telegram.js');
const { runAccount } = await import('./tasks.js');
const { launchBrowser, newContext, createLogger, sendDetails, sendSummary, saveAccountUpdate, sendHeader, settings } = await import('./runner.js');

const DEBUG = String(process.env.DEBUG).toLowerCase() === 'true';
const ONLY = (process.env.ACCOUNT || '').trim();

try {
  const { store } = await loadStore();
  const names = Object.keys(store.accounts).filter((n) => !ONLY || n === ONLY);
  if (!names.length) {
    await sendMessage(process.env.ADMIN_ID, 'هیچ اکانتی ثبت نشده.');
  } else {
    await sendHeader(names, DEBUG);
    const browser = await launchBrowser();
    for (const name of names) {
      const acc = store.accounts[name];
      const log = createLogger();
      const context = await newContext(browser, acc);
      let result;
      try {
        result = await runAccount(context, acc, { log, debug: DEBUG, ...settings() });
      } catch (e) {
        result = { steps: [{ label: 'اجرا', status: 'error', note: e.message }], loggedIn: true };
      }
      const session = result.loggedIn ? await context.storageState().catch(() => undefined) : undefined;
      await context.close();
      await sendDetails(name, log, { debug: DEBUG, steps: result.steps, loggedIn: result.loggedIn });
      await sendSummary(name, result);
      await saveAccountUpdate(name, {
        lastRun: { at: new Date().toISOString(), loggedIn: result.loggedIn, steps: result.steps.map(({ label, status, note }) => ({ label, status, note })) },
        lastPurchaseDay: acc.lastPurchaseDay,
        session,
      });
    }
    await browser.close();
  }
} catch (e) {
  console.error(e);
  await sendMessage(process.env.ADMIN_ID, '❌ ' + esc(e.message)).catch(() => {});
  process.exit(1);
}
