# OCBC TV Display

A full-screen lobby display for the **SGI-USA Orange County Buddhist Center** showing:

- **Today at the Center** — today's events from the center's calendar (the same
  KeepAndShare calendar embedded at [ocvictory.com/events](https://ocvictory.com/events/))
- **Towards 2030 with Ikeda Sensei** — the daily quote from
  [cms.sgi-usa.org/tmf](https://cms.sgi-usa.org/tmf/), fetched live
- A clock, today's date, and a preview of the next six days

## How it works

- `index.html` + `css/` + `js/` — a static page, hosted on GitHub Pages.
- `scripts/scrape-events.mjs` — a Playwright scraper that reads the public
  KeepAndShare calendar embed and writes `data/events.json` (a 14-day window,
  Pacific time). Open "Sign Up Now" room slots are filtered out; multi-day
  banners like "District Activity Week" are expanded across their dates.
- `.github/workflows/update-events.yml` — runs the scraper three times a day
  (~5 AM, 9 AM, 4 PM Pacific) and commits `data/events.json` when it changes,
  which redeploys the page automatically.
- The quote needs no scraping: the SGI-USA WordPress API allows cross-origin
  requests, so the page fetches it directly in the browser and keeps the last
  good quote in `localStorage` as a fallback.

The page refreshes its data every 30 minutes, rolls over at midnight, and does
a full reload nightly at 3:30 AM so it can run unattended indefinitely.

On busy days the Today panel switches to two columns and scales the cards to
fit the screen, so every event shows on a 1080p TV; only if a window is too
small for everything does it trim to a "+ N more" line.

## Previewing another date

Add `?date=YYYY-MM-DD` to the URL to see what the display will look like on
any day in the scraped two-week window:

- Live site: `https://7uhi.github.io/ocbc-tv/?date=2026-07-26`
- Local: `python3 -m http.server 8080` in this folder, then open
  `http://localhost:8080/?date=2026-07-26`

The header shows the previewed date marked **"(preview)"** so it can't be
mistaken for the live display. Notes: the quote panel always shows the current
day's quote (the SGI API only publishes one day at a time), the clock keeps
real time, and dates outside the scraped window show the "schedule
unavailable" message. Remove the parameter to return to the normal live view.

## Setting up the TV

Open the GitHub Pages URL full-screen on whatever drives the TV, and disable
sleep/screensavers on that device:

- **Amazon Fire Stick** — install the *Silk Browser*, open the URL, then
  Menu → Fullscreen. In Settings, set Display sleep to Never.
- **PC / Mac mini** — run Chrome in kiosk mode:
  `chrome --kiosk https://<user>.github.io/ocbc-tv/` and disable OS sleep.
- **Raspberry Pi** — use `chromium-browser --kiosk <url>` in the autostart
  file, and `xset s off -dpms` to keep the screen on.

## Maintenance

- **Red ✗ on the "Update calendar events" workflow** means KeepAndShare changed
  their markup and the scraper found zero events; the TV keeps showing the last
  good data (with a "last updated" note after 2 days). Fix the selectors in
  `scripts/scrape-events.mjs`.
- Run the scraper locally with `npm install && npx playwright install chromium`
  then `npm run scrape`; preview with `python3 -m http.server` and open
  `http://localhost:8000`.
- If the center ever gets login access to its KeepAndShare account, publishing
  an iCal feed from there would let the scraper be replaced with a plain fetch.
