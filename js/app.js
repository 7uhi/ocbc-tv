/* OCBC lobby TV display.
   Events come from data/events.json (written by the scheduled scraper);
   the Towards 2030 quote comes straight from the SGI-USA WordPress API,
   which sends permissive CORS headers, with localStorage as fallback. */

const TZ = 'America/Los_Angeles';
const QUOTE_API =
  'https://cms.sgi-usa.org/wp-json/wp/v2/posts?per_page=1&_fields=date,content';
const REFRESH_MS = 30 * 60 * 1000;
const MAX_TODAY_EVENTS = 8;
const WEEK_DAYS = 6;

const $ = (sel) => document.querySelector(sel);

function laToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// "7p" / "6:30p" → "7:00 PM"; "7p-8p" → "7:00 – 8:00 PM"
function formatTime(t) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])/i.exec(t || '');
  if (!m) return t || '';
  return `${m[1]}:${m[2] || '00'} ${m[3].toLowerCase() === 'p' ? 'PM' : 'AM'}`;
}

function formatRange(range, single) {
  if (range) {
    const parts = range.split('-');
    if (parts.length === 2) {
      const a = formatTime(parts[0]);
      const b = formatTime(parts[1]);
      if (a && b) {
        const [at, aap] = [a.slice(0, -3), a.slice(-2)];
        const [bt, bap] = [b.slice(0, -3), b.slice(-2)];
        return aap === bap ? `${at} – ${bt} ${bap}` : `${a} – ${b}`;
      }
    }
  }
  return formatTime(single);
}

/* ---------- clock ---------- */

function tickClock() {
  const now = new Date();
  $('#clock').textContent = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit',
  }).format(now);
  $('#date').textContent = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(now);
}

/* ---------- events ---------- */

let eventsData = null;

async function loadEvents() {
  try {
    const res = await fetch(`data/events.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    eventsData = await res.json();
  } catch (err) {
    console.error('events load failed:', err);
  }
  renderEvents();
}

function dayFor(date) {
  return eventsData?.days?.find((d) => d.date === date) || null;
}

function renderEvents() {
  const list = $('#event-list');
  const note = $('#events-note');
  const today = laToday();
  const day = dayFor(today);

  if (!day) {
    list.innerHTML = `
      <div class="no-events">
        <div class="zen">☸</div>
        <div>Schedule is temporarily unavailable.<br>
        Please see the calendar at <strong>ocvictory.com/events</strong></div>
      </div>`;
    note.textContent = '';
    renderWeek(today);
    return;
  }

  if (day.events.length === 0) {
    list.innerHTML = `
      <div class="no-events">
        <div class="zen">☸</div>
        <div>No events scheduled today.<br>Enjoy a peaceful visit!</div>
      </div>`;
  } else {
    const shown = day.events.slice(0, MAX_TODAY_EVENTS);
    const extra = day.events.length - shown.length;
    list.innerHTML = shown.map((e) => `
      <div class="event-card${e.allDay ? ' all-day' : ''}">
        <div class="event-time">${e.allDay ? 'All Day' : esc(formatRange(e.timeRange, e.time))}</div>
        <div class="event-body">
          <div class="event-title">${esc(e.title)}</div>
          ${e.room ? `<div class="event-room">${esc(e.room)}</div>` : ''}
        </div>
      </div>`).join('')
      + (extra > 0 ? `<div class="event-more">+ ${extra} more — see full calendar at ocvictory.com/events</div>` : '');
  }

  // surface staleness quietly if the scraper has been failing for days
  const age = (Date.now() - Date.parse(eventsData.scrapedAt)) / 86400000;
  note.textContent = age > 2
    ? `Schedule last updated ${new Intl.DateTimeFormat('en-US', {
        timeZone: TZ, month: 'short', day: 'numeric',
      }).format(new Date(eventsData.scrapedAt))}`
    : '';

  renderWeek(today);
}

function renderWeek(today) {
  const strip = $('#week-strip');
  const cols = [];
  for (let i = 1; i <= WEEK_DAYS; i++) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const day = dayFor(iso);
    const name = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(d);
    const md = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d);

    let body;
    if (!day || day.events.length === 0) {
      body = '<div class="week-none">No events</div>';
    } else {
      const shown = day.events.slice(0, 4);
      body = shown.map((e) => `
        <div class="week-event">
          <span class="t">${e.allDay ? '•' : esc(e.time || '')}</span>
          <span class="n">${esc(e.title)}</span>
        </div>`).join('');
      if (day.events.length > shown.length) {
        body += `<div class="week-more">+ ${day.events.length - shown.length} more</div>`;
      }
    }
    cols.push(`
      <div class="week-day">
        <div class="week-day-name">${name}</div>
        <div class="week-day-date">${md}</div>
        ${body}
      </div>`);
  }
  strip.innerHTML = cols.join('');
}

/* ---------- quote ---------- */

async function loadQuote() {
  let post = null;
  try {
    const res = await fetch(QUOTE_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const posts = await res.json();
    if (posts[0]?.content?.rendered) {
      post = posts[0];
      localStorage.setItem('ocbc-quote', JSON.stringify(post));
    }
  } catch (err) {
    console.error('quote load failed:', err);
    try { post = JSON.parse(localStorage.getItem('ocbc-quote')); } catch { /* ignore */ }
  }
  renderQuote(post);
}

function renderQuote(post) {
  const body = $('#quote-body');
  const source = $('#quote-source');
  if (!post) {
    body.innerHTML = '<div class="loading light">Today&rsquo;s guidance is unavailable right now.</div>';
    source.textContent = '';
    return;
  }

  // content.rendered is trusted-ish WordPress HTML, but render text only
  const doc = new DOMParser().parseFromString(post.content.rendered, 'text/html');
  const paras = Array.from(doc.querySelectorAll('p'))
    .map((p) => p.textContent.trim())
    .filter(Boolean);

  let attribution = '';
  if (paras.length > 1 && /^From\s/i.test(paras[paras.length - 1])) {
    attribution = paras.pop();
  }

  body.innerHTML = paras.map((t, i) =>
    `<p>${i === 0 ? '<span class="open-quote">“</span>' : ''}${esc(t)}</p>`).join('');
  source.textContent = attribution;
  fitQuote(body);
}

// shrink the quote font until it fits its panel
function fitQuote(body) {
  let size = 2.0;
  body.style.fontSize = size + 'rem';
  while (size > 1.0 && body.scrollHeight > body.clientHeight) {
    size -= 0.1;
    body.style.fontSize = size.toFixed(1) + 'rem';
  }
}

/* ---------- plumbing ---------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let renderedFor = laToday();

function everySecond() {
  tickClock();
  const now = laToday();
  if (now !== renderedFor) {          // midnight rollover
    renderedFor = now;
    renderEvents();
    loadQuote();
  }
  // nightly full reload at ~3:30 AM to keep long-running TV browsers fresh
  const hm = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit',
  }).format(new Date());
  if (hm === '03:30') location.reload();
}

tickClock();
loadEvents();
loadQuote();
setInterval(everySecond, 1000);
setInterval(() => { loadEvents(); loadQuote(); }, REFRESH_MS);
window.addEventListener('resize', () => {
  const body = $('#quote-body');
  if (body) fitQuote(body);
});
