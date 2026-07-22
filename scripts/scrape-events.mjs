// Scrapes the OCBC KeepAndShare calendar (the same one embedded on
// ocvictory.com/events/) and writes data/events.json with a 14-day window
// starting today (America/Los_Angeles).
//
// KeepAndShare renders events client-side, so this uses Playwright. The DOM
// contract this relies on (verified 2026-07-21):
//   - each event is a `.cal_event` whose onclick is
//     `showEventByDate(this, 'YYYYMMDD', <eventId>, ...)`
//   - `.calEventDisplay_text` holds the display text, and its `title`
//     attribute holds the full time range, e.g. "7p-8p  (1:00) Toso"
//   - multi-day banner events sit inside `.cal_display_longevent` and their
//     title attr describes the span: "Start: July 6, 2026 for 6 days"
//   - open self-book room slots have no title, only "Sign Up Now" — skipped
// If KeepAndShare changes this markup the scraper exits non-zero so the
// GitHub Action run turns red instead of silently publishing an empty file.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAL_ID = '2694020';
const TZ = 'America/Los_Angeles';
const WINDOW_DAYS = 14;

const embedUrl = (startdate = '') =>
  `https://www.keepandshare.com/calendar25/show.php?i=${CAL_ID}&em=y&style=r&fmt=std&startdate=${startdate}&soffset=0&n=14&sparse=n&ifr=y`;

// "today" as a YYYY-MM-DD string in LA, regardless of runner timezone
function laToday() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return p; // en-CA gives YYYY-MM-DD
}

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const yyyymmddToIso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

// "7p" / "6:30p" / "10a" / "12p" → minutes since midnight, for sorting
function timeToMinutes(t) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])/i.exec(t || '');
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  return h * 60 + (m[2] ? parseInt(m[2], 10) : 0);
}

// "Start: July 6, 2026 for 6 days" → [iso, iso, ...]; null if not that shape
function expandBannerDates(titleAttr, fallbackDate) {
  const m = /Start:\s*([A-Za-z]+ \d{1,2}, \d{4})\s+for\s+(\d+)\s+days?/.exec(titleAttr || '');
  if (!m) return [fallbackDate];
  const start = new Date(`${m[1]} 12:00 UTC`);
  if (isNaN(start)) return [fallbackDate];
  const iso = start.toISOString().slice(0, 10);
  const n = Math.min(parseInt(m[2], 10), 62);
  return Array.from({ length: n }, (_, i) => addDays(iso, i));
}

async function scrapeMonth(page, startdate) {
  await page.goto(embedUrl(startdate), { waitUntil: 'networkidle', timeout: 90000 });
  // onclick attrs are attached by JS a beat after the elements render
  await page.waitForSelector('.cal_event[onclick*="showEventByDate"]', { timeout: 45000 });
  await page.waitForTimeout(1500);

  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.cal_event[onclick*="showEventByDate"]').forEach((el) => {
      const m = /showEventByDate\(this,\s*'(\d{8})',\s*(\d+)/.exec(el.getAttribute('onclick') || '');
      if (!m) return;
      const textEl = el.querySelector('.calEventDisplay_text');
      if (!textEl) return;
      const lineText = (el.closest('.calendar_one_line') || el).innerText || '';
      out.push({
        date: m[1],
        id: m[2],
        titleAttr: (textEl.getAttribute('title') || '').replace(/ /g, ' ').trim(),
        text: (textEl.innerText || '').replace(/\s+/g, ' ').trim(),
        startTime: (textEl.querySelector('.cal_date_highlight')?.innerText || '').trim(),
        isBanner: !!el.closest('.cal_display_longevent'),
        isSignup: /Sign Up Now/i.test(lineText),
      });
    });
    return out;
  });
}

function parseEvent(raw) {
  // text looks like "7p Toso -- Gohonzon Room C"; strip the leading time
  let text = raw.text;
  if (raw.startTime && text.startsWith(raw.startTime)) {
    text = text.slice(raw.startTime.length).trim();
  }
  const sep = /(?:^|\s)--\s/.exec(text);
  let title = sep ? text.slice(0, sep.index) : text;
  const room = sep
    ? text.slice(sep.index + sep[0].length).replace(/Sign Up Now.*$/i, '').trim()
    : '';
  title = title.replace(/Sign Up Now.*$/i, '').trim();

  // time range from the title attr: "7p-8p  (1:00) Toso ..."
  const tr = /^(\S+\s*-\s*\S+)\s+\([\d:]+\)/.exec(raw.titleAttr);
  return {
    title,
    room,
    time: raw.startTime || null,
    timeRange: tr ? tr[1].replace(/\s/g, '') : null,
    allDay: !raw.startTime,
  };
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 2400 } });

  const today = laToday();
  const monthStarts = new Set(['']); // '' = current month
  // if the 14-day window crosses into next month, fetch that month too
  const windowEnd = addDays(today, WINDOW_DAYS - 1);
  if (windowEnd.slice(0, 7) !== today.slice(0, 7)) {
    monthStarts.add(`${windowEnd.slice(0, 7).replace('-', '')}01`);
  }

  const rawEvents = [];
  for (const start of monthStarts) {
    rawEvents.push(...await scrapeMonth(page, start));
  }
  if (rawEvents.length === 0) {
    console.error('Scrape parsed zero events — KeepAndShare markup may have changed.');
    process.exit(1);
  }

  // expand banners across their span, then bucket by date, dedupe by id+date
  const byDate = new Map();
  const seen = new Set();
  for (const raw of rawEvents) {
    const ev = parseEvent(raw);
    if (!ev.title) continue; // open "Sign Up Now" slots and blank entries
    if (raw.isSignup && !ev.title) continue;
    const dates = raw.isBanner
      ? expandBannerDates(raw.titleAttr, yyyymmddToIso(raw.date))
      : [yyyymmddToIso(raw.date)];
    for (const date of dates) {
      const key = `${raw.id}:${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(ev);
    }
  }

  const days = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const date = addDays(today, i);
    const events = (byDate.get(date) || []).sort((a, b) => {
      const ta = timeToMinutes(a.time), tb = timeToMinutes(b.time);
      if (ta === null && tb === null) return a.title.localeCompare(b.title);
      if (ta === null) return -1; // all-day banners first
      if (tb === null) return 1;
      return ta - tb || a.title.localeCompare(b.title);
    });
    days.push({ date, events });
  }

  const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'events.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({
    scrapedAt: new Date().toISOString(),
    timezone: TZ,
    source: `https://www.keepandshare.com/calendar25/show.php?i=${CAL_ID}`,
    days,
  }, null, 2) + '\n');

  const total = days.reduce((n, d) => n + d.events.length, 0);
  console.log(`Wrote ${outPath}: ${total} events across ${WINDOW_DAYS} days from ${today}.`);
} finally {
  await browser.close();
}
