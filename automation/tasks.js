// What the bot does on the OneState website for one account.
// Elements are found by their visible text (Day N, CLAIM, AVAILABLE, ...), not by fixed positions,
// so the daily day number can differ per account.

const BASE = process.env.ONESTATE_BASE || 'https://onestate.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const todayKey = () => new Date().toISOString().slice(0, 10); // OneState resets at 00:00 UTC

const TASKS = [
  { key: 'visit', label: 'تسک Visit our website', rx: 'visit our website|посетите (наш )?сайт|посетить сайт' },
  { key: 'calTask', label: 'تسک Claim a reward in calendar', rx: 'reward in the rewards calendar|наград[уы] в календаре' },
];

// ---------------------------------------------------------------- in-page helpers
// These functions run inside the website page.

function analyzeCalendar() {
  const B = (w) => new RegExp(`(?:^|[^a-z])(?:${w})(?:[^a-z]|$)`);
  const RX_CHECK = B('check(?:ed|mark)?|claimed|received|collected|completed?|done|success|taken|tick');
  const RX_LOCK = B('lock(?:ed)?|disabled|future|inactive|unavailable|closed|blocked|wait(?:ing)?');
  const RX_AVAIL = B('available|claimable|can-?claim|current|today|ready|active|open');
  const dayRx = /^(day|день)\s*(\d+)$/i;
  const labels = [...document.querySelectorAll('body *')].filter(
    (e) => dayRx.test((e.textContent || '').trim()) && ![...e.children].some((c) => dayRx.test((c.textContent || '').trim())),
  );
  const sig = (el) => {
    const cls = typeof el.className === 'string' ? el.className : el.className?.baseVal || '';
    const attrs = [...(el.attributes || [])]
      .filter((a) => a.name.startsWith('data-') && !a.name.startsWith('data-os') || ['src', 'alt', 'href', 'xlink:href', 'aria-label', 'title', 'aria-disabled', 'disabled'].includes(a.name))
      .map((a) => `${a.name}=${a.value}`)
      .join(' ');
    return `${cls} ${attrs}`;
  };
  return labels.map((lab, idx) => {
    const day = Number(lab.textContent.match(/\d+/)[0]);
    let cell = lab;
    for (let i = 0; i < 8 && cell.parentElement; i++) {
      const p = cell.parentElement;
      if (((p.innerText || '').match(/(day|день)\s*\d+/gi) || []).length > 1) break;
      cell = p;
    }
    cell.setAttribute('data-os-cell', String(idx));
    const nodes = [cell, ...cell.querySelectorAll('*')];
    let blob = nodes.map(sig).join(' ').toLowerCase();
    for (const el of [cell, ...cell.children]) {
      for (const ps of ['::before', '::after']) {
        const st = getComputedStyle(el, ps);
        if (st.content && st.content !== 'none') blob += ' ' + st.backgroundImage + ' ' + st.content;
      }
    }
    const text = (cell.innerText || '').replace(/\s+/g, ' ').trim();
    const st = getComputedStyle(cell);
    const btn = [...cell.querySelectorAll('button,[role=button],a')].find((b) =>
      /^(claim|collect|get|take|забрать|получить|собрать)/i.test((b.innerText || '').trim()),
    );
    if (btn) btn.setAttribute('data-os-claim', String(idx));
    return {
      idx,
      day,
      text: text.slice(0, 60),
      claimBtn: !!btn,
      claimText: /\b(claim|collect|забрать|получить)\b/i.test(text) && !/claimed|получено/i.test(text),
      checked: RX_CHECK.test(blob),
      locked: RX_LOCK.test(blob),
      available: RX_AVAIL.test(blob) && !RX_CHECK.test(blob) && !RX_LOCK.test(blob),
      opacity: st.opacity,
      filter: st.filter,
      cursor: st.cursor,
      blob: blob.replace(/\s+/g, ' ').trim().slice(0, 500),
    };
  });
}

function inspectTask(src) {
  const rx = new RegExp(src, 'i');
  document.querySelectorAll('[data-os-task-btn]').forEach((e) => e.removeAttribute('data-os-task-btn'));
  const leaves = [...document.querySelectorAll('body *')].filter(
    (e) => rx.test(e.textContent || '') && ![...e.children].some((c) => rx.test(c.textContent || '')),
  );
  if (!leaves.length) return { found: false };
  const SEL = 'button,[role=button],a,[class*="btn" i],[class*="button" i]';
  let card = leaves[0];
  let btns = [];
  for (let i = 0; i < 10 && card; i++) {
    btns = [...card.querySelectorAll(SEL)].filter((b) => (b.innerText || '').trim());
    if (btns.length) break;
    card = card.parentElement;
  }
  if (!btns.length) return { found: true, state: 'unknown', btnText: '' };
  // the outermost button-like element that is last in the card
  const outer = btns.filter((b) => !btns.some((o) => o !== b && o.contains(b)));
  const b = outer[outer.length - 1];
  const t = (b.innerText || '').trim().replace(/\s+/g, ' ');
  const progress = ((card.innerText || '').match(/\d+\s*\/\s*\d+/) || [''])[0];
  let state = 'unknown';
  if (/claimed|received|получено|забрано|выполнено/i.test(t)) state = 'claimed';
  else if (/^(claim|collect|get|take|забрать|получить)/i.test(t)) state = 'claimable';
  else if (/^(go|перейти|выполнить)/i.test(t)) state = 'not_ready';
  if (state === 'claimable') b.setAttribute('data-os-task-btn', '1');
  return { found: true, state, btnText: t, progress, disabled: !!b.disabled || b.getAttribute('aria-disabled') === 'true' };
}

function inspectShop(name) {
  document.querySelectorAll('[data-os-buy]').forEach((e) => e.removeAttribute('data-os-buy'));
  const avSrc = '(available|доступно)\\s*:?\\s*(\\d+)';
  const avRx = new RegExp(avSrc, 'i');
  const labels = [...document.querySelectorAll('body *')].filter(
    (e) => avRx.test(e.textContent || '') && ![...e.children].some((c) => avRx.test(c.textContent || '')),
  );
  const cards = labels.map((lab) => {
    let card = lab;
    for (let i = 0; i < 8 && card.parentElement; i++) {
      const p = card.parentElement;
      if (((p.innerText || '').match(new RegExp(avSrc, 'gi')) || []).length > 1) break;
      card = p;
    }
    const lines = (card.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const clickables = [...card.querySelectorAll('button,[role=button],a,[class*="btn" i],[class*="button" i],[class*="price" i]')]
      .filter((b) => (b.innerText || '').trim());
    const outer = clickables.filter((b) => !clickables.some((o) => o !== b && o.contains(b)));
    const priceEl = outer[outer.length - 1] || null;
    const priceText = priceEl ? priceEl.innerText.trim().replace(/\s+/g, ' ') : lines[lines.length - 1] || '';
    const nameLines = lines.filter((l) => !avRx.test(l) && l !== priceText);
    return { card, priceEl, priceText, nameLines, available: Number((lab.textContent.match(avRx) || [])[2]) };
  });
  const matches = cards.filter((c) => c.nameLines.includes(name));
  const t = matches[matches.length - 1];
  const list = cards.map((c) => `${c.nameLines.join('|')} [${c.priceText}] avail=${c.available}`);
  if (!t) return { found: false, count: cards.length, list };
  (t.priceEl || t.card).setAttribute('data-os-buy', '1');
  return { found: true, count: cards.length, available: t.available, price: t.priceText, index: cards.indexOf(t), list };
}

function markByText([src, flags]) {
  const rx = new RegExp(src, flags);
  document.querySelectorAll('[data-os-tab]').forEach((e) => e.removeAttribute('data-os-tab'));
  const el = [...document.querySelectorAll('a,button,[role=tab],[role=button],li,div,span')]
    .filter((e) => e.offsetParent !== null && rx.test((e.innerText || '').trim()))
    .sort((a, b) => a.innerText.length - b.innerText.length)[0];
  if (!el) return false;
  el.setAttribute('data-os-tab', '1');
  return true;
}

function findModalButton([src, flags]) {
  const rx = new RegExp(src, flags);
  document.querySelectorAll('[data-os-modal]').forEach((e) => e.removeAttribute('data-os-modal'));
  const roots = [...document.querySelectorAll('[role=dialog],[aria-modal=true],[class*="modal" i],[class*="popup" i],[class*="dialog" i]')]
    .filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed');
  for (const root of roots) {
    const b = [...root.querySelectorAll('button,[role=button],a,[class*="btn" i]')].find(
      (x) => x.offsetParent !== null && rx.test((x.innerText || '').trim()),
    );
    if (b) {
      b.setAttribute('data-os-modal', '1');
      return (b.innerText || '').trim();
    }
  }
  return null;
}

// ---------------------------------------------------------------- Node-side helpers

async function waitText(page, rx, timeout) {
  try {
    await page.waitForFunction(([s, f]) => new RegExp(s, f).test(document.body?.innerText || ''), [rx.source, rx.flags], { timeout });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await sleep(1200);
    return true;
  } catch {
    return false;
  }
}

async function open(page, path, marker) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (!(await waitText(page, marker, 35000))) throw new Error(`صفحه‌ی ${path} درست باز نشد`);
}

async function clickSel(page, selector) {
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  try {
    await loc.click({ timeout: 5000 });
  } catch {
    // something (an overlay, the support button...) is on top of it — click it directly
    await loc.dispatchEvent('click');
  }
}

async function confirmModal(page) {
  const label = await page.evaluate(findModalButton, [
    '^(claim|collect|get|take|ok|okay|confirm|yes|buy|purchase|забрать|получить|ок|да|купить|подтвердить)!?$',
    'i',
  ]);
  if (!label) return null;
  await clickSel(page, '[data-os-modal]');
  await sleep(2000);
  return label;
}

async function closeModals(page) {
  const label = await page.evaluate(findModalButton, ['^(close|ok|okay|×|✕|x|закрыть|ок)$', 'i']);
  if (label) await clickSel(page, '[data-os-modal]').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
}

const writes = (net, from) => net.slice(from).filter((x) => x.m !== 'GET');

// ---------------------------------------------------------------- steps

export async function claimCalendar(page, net, log) {
  await open(page, '/calendar', /(day|день)\s*1\b/i);
  const cells = await page.evaluate(analyzeCalendar);
  log.file('calendar-cells.json', JSON.stringify(cells, null, 2));
  if (!cells.length) throw new Error('خانه‌های تقویم پیدا نشد');

  const target =
    cells.find((c) => c.claimBtn) ||
    cells.find((c) => c.claimText) ||
    cells.find((c) => c.available) ||
    cells.find((c) => !c.checked && !c.locked);
  if (!target) return { status: 'done', note: `همه‌ی ${cells.length} روز قبلاً گرفته شده` };

  const from = net.length;
  await clickSel(page, target.claimBtn ? `[data-os-claim="${target.idx}"]` : `[data-os-cell="${target.idx}"]`);
  await sleep(2500);
  await confirmModal(page);
  await sleep(1000);

  const after = (await page.evaluate(analyzeCalendar)).find((c) => c.day === target.day);
  const w = writes(net, from);
  const okWrite = w.find((x) => x.s >= 200 && x.s < 300);
  const badWrite = w.find((x) => x.s >= 400);
  await closeModals(page);

  if ((after && after.checked && !target.checked) || okWrite) return { status: 'ok', note: `روز ${target.day} گرفته شد` };
  if (badWrite) return { status: 'skip', note: `روز ${target.day}: سایت قبول نکرد (${badWrite.s}) — احتمالاً امروز قبلاً گرفته شده` };
  return { status: 'unknown', note: `روی روز ${target.day} کلیک شد ولی تأییدی دیده نشد (شاید امروز قبلاً گرفته شده)` };
}

const SECTION = {
  tasks: {
    marker: /tasks reset in|visit our website|задания обновятся|посетите/i,
    paths: (slug) => [`/events/${slug}/task`, `/events/${slug}/tasks`, `/events/${slug}`],
    tab: /^(event\s+)?tasks?$|^задания( события)?$/i,
    env: 'TASKS_PATH',
  },
  store: {
    marker: /(available|доступно)\s*:?\s*\d+/i,
    paths: (slug) => [`/events/${slug}/showcase`, `/events/${slug}/shop`, `/events/${slug}/store`, `/events/${slug}`],
    tab: /^(event\s+)?(store|shop|showcase)$|^магазин( события)?$/i,
    env: 'STORE_PATH',
  },
};

async function openSection(page, slug, kind) {
  const s = SECTION[kind];
  const paths = process.env[s.env] ? [process.env[s.env]] : s.paths(slug);
  for (const p of paths) {
    try {
      await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch {
      continue;
    }
    if (await waitText(page, s.marker, 15000)) return p;
    if (await page.evaluate(markByText, [s.tab.source, s.tab.flags])) {
      await clickSel(page, '[data-os-tab]');
      if (await waitText(page, s.marker, 12000)) return p;
    }
  }
  throw new Error(`صفحه‌ی ${kind === 'tasks' ? 'تسک‌های' : 'فروشگاه'} ایونت «${slug}» پیدا نشد`);
}

async function claimTask(page, net, task) {
  const before = await page.evaluate(inspectTask, task.rx);
  if (!before.found) return { status: 'error', note: 'این تسک در صفحه پیدا نشد' };
  if (before.state === 'claimed') return { status: 'claimed', note: 'قبلاً گرفته شده' };
  if (before.state === 'not_ready') return { status: 'not_ready', note: `هنوز انجام نشده (${before.progress || before.btnText})` };
  if (before.state !== 'claimable') return { status: 'unknown', note: `دکمه‌ی ناشناخته: «${before.btnText}»` };

  const from = net.length;
  await clickSel(page, '[data-os-task-btn]');
  await sleep(2500);
  await confirmModal(page);
  const after = await page.evaluate(inspectTask, task.rx);
  await closeModals(page);
  if (after.state === 'claimed' || writes(net, from).some((x) => x.s >= 200 && x.s < 300)) return { status: 'ok', note: 'گرفته شد' };
  return { status: 'unknown', note: `کلیک شد ولی تأیید نشد (دکمه: «${after.btnText}»)` };
}

async function buyItem(page, net, slug, itemName, acc, log) {
  if (acc.lastPurchaseDay === todayKey()) return { status: 'skip', note: 'امروز قبلاً خریده شده' };
  await openSection(page, slug, 'store');
  const info = await page.evaluate(inspectShop, itemName);
  log.file('store-items.json', JSON.stringify(info, null, 2));
  if (!info.found) throw new Error(`آیتم «${itemName}» پیدا نشد. آیتم‌های دیده‌شده: ${info.list.join(' / ') || 'هیچ'}`);

  const from = net.length;
  await clickSel(page, '[data-os-buy]');
  await sleep(2000);
  const confirmed = await confirmModal(page);
  await sleep(1500);
  const body = await page.evaluate(() => document.body.innerText);
  if (/not enough|insufficient|недостаточно/i.test(body)) {
    await closeModals(page);
    return { status: 'fail', note: 'سکه‌ی ایونت کافی نیست' };
  }
  const after = await page.evaluate(inspectShop, itemName);
  const w = writes(net, from);
  const okWrite = w.find((x) => x.s >= 200 && x.s < 300);
  const badWrite = w.find((x) => x.s >= 400);
  await closeModals(page);
  const avail = `Available: ${info.available} → ${after.found ? after.available : '?'}`;
  if (okWrite || (after.found && after.available !== info.available)) {
    acc.lastPurchaseDay = todayKey();
    return { status: 'ok', note: `خرید انجام شد (${avail})` };
  }
  if (badWrite) return { status: 'fail', note: `سایت خرید را رد کرد (${badWrite.s}) — ${avail}` };
  return { status: 'unknown', note: `روی خرید کلیک شد${confirmed ? ` و «${confirmed}» تأیید شد` : ''} ولی نتیجه معلوم نیست (${avail})` };
}

async function looksLoggedOut(page, net) {
  if (net.some((x) => x.s === 401)) return true;
  return page.evaluate(() =>
    [...document.querySelectorAll('a,button,[role=button]')].some(
      (e) => e.offsetParent !== null && /^(log\s*in|sign\s*in|login|войти|вход|авторизация)$/i.test((e.innerText || '').trim()),
    ),
  );
}

// ---------------------------------------------------------------- per-account flow

// The work is split into 3 steps so each one fits in a short serverless call.
export const STEPS = ['calendar', 'tasks', 'store'];
export const STEP_LABELS = { calendar: 'تقویم Daily Rewards', tasks: 'تسک‌های ایونت', store: 'فروشگاه ایونت' };

export async function runAccountStep(context, acc, stepName, { log, debug, slug, itemName }) {
  const page = await context.newPage();
  const net = [];
  page.on('response', (r) => {
    const t = r.request().resourceType();
    if (t === 'xhr' || t === 'fetch') net.push({ m: r.request().method(), u: r.url(), s: r.status() });
  });

  const result = { steps: [], loggedIn: true };
  const step = async (key, label, fn) => {
    try {
      const r = await fn();
      result.steps.push({ key, label, ...r });
      if (debug || r.status === 'unknown') await log.shot(page, `${label}: ${r.note || r.status}`);
    } catch (e) {
      result.steps.push({ key, label, status: 'error', note: String(e.message).split('\n')[0].slice(0, 300) });
      await log.shot(page, `${label} — خطا`);
    }
  };

  if (stepName === 'calendar') {
    await step('calendar', STEP_LABELS.calendar, () => claimCalendar(page, net, log));
    if (await looksLoggedOut(page, net).catch(() => false)) result.loggedIn = false;
  } else if (stepName === 'tasks') {
    let tasksOpen = false;
    for (const task of TASKS) {
      await step(task.key, task.label, async () => {
        if (!tasksOpen) {
          await openSection(page, slug, 'tasks');
          tasksOpen = true;
        }
        return claimTask(page, net, task);
      });
    }
  } else if (stepName === 'store') {
    await step('buy', `خرید آیتم «${itemName}»`, () => buyItem(page, net, slug, itemName, acc, log));
  }

  log.file(`network-${stepName}.json`, JSON.stringify(net, null, 1));
  await page.close().catch(() => {});
  return result;
}

// All steps in one go (used when running on your own PC).
export async function runAccount(context, acc, opts) {
  const result = { steps: [], loggedIn: true };
  for (const name of STEPS) {
    const r = await runAccountStep(context, acc, name, opts);
    result.steps.push(...r.steps);
    if (!r.loggedIn) {
      result.loggedIn = false;
      break;
    }
  }
  return result;
}
