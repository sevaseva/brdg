# Night Hikes

Everything about the moonlight hiking page lives here: what it computes, where the data comes from,
how to regenerate it, and how the forecasts and estimates work. General site rules (deployment,
Jekyll, styling, accessibility) are in [AGENTS.md](AGENTS.md).

The page is at `/night-hikes/` and has three layers:

1. **The moonlight hiking almanac** — every good night in the next 14 days, generated at build time.
   The client chooses the window relative to the visitor's day, so the card count can vary.
2. **The Rest of the Sky** — tonight's dark and moon-free windows, planets, deep-sky targets, and
   live weather/air/aurora.
3. **Looking Ahead** — meteor showers, eclipses, conjunctions, dark-of-moon dates, satellites, and
   the club's curiosities.

## Build and deployment

- The GitHub Actions workflow regenerates the 90-day almanac and the sky-steadiness forecast before
  Jekyll runs: every three days at 08:17 UTC, and on every push. 7Timer covers 72 hours, so the
  third evening can fall outside the forecast and the page then says no forecast is available. The
  workflow installs Node 26 and runs `npm ci` first.
- `assets/data/night-hikes.json` is committed as a preview so a plain local `jekyll serve` has data
  even before the generator runs. CI overwrites it with a fresh chart; the committed copy is a
  fallback, not the source of truth.
- The astronomy is bundled into the JSON at build time. No third-party JavaScript is sent to the
  browser for the almanac or the sky panels.
- The workflow and Jekyll version are described in AGENTS.md; the night-hike step is just
  `npm run generate:night-hikes`.

## Files

| Path                                  | Purpose                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `night-hikes.html`                    | Page shell and static copy; placeholders for the rendered almanac and sky panels.                                                    |
| `assets/js/night-hikes.js`            | Fetches the JSON, picks the next nights in Cobb local time, renders the almanac and the sky panels.                                  |
| `assets/js/night-hikes-conditions.js` | Fetches live weather, air quality, and the aurora forecast; degrades to "unavailable" when a request fails.                          |
| `assets/data/night-hikes.json`        | Generated 90-day almanac, including the per-night `sky` payload.                                                                     |
| `scripts/night-hikes/generate.mjs`    | Build-time generator: assembles each night's data, evaluates the conditions, and writes the JSON.                                    |
| `scripts/night-hikes/conditions.mjs`  | The condition registry (what makes a night good) and the per-night features (what is merely interesting).                            |
| `scripts/night-hikes/sky.mjs`         | Wrapper around Astronomy Engine: sun/moon rise, set, altitude, and phase.                                                            |
| `scripts/night-hikes/sky-extras.mjs`  | Build-time extras: dark windows, Milky Way, planets, deep-sky targets, showers, eclipses, conjunctions, satellites, 7Timer forecast. |
| `scripts/night-hikes/horizon.json`    | Cached local ridge profile (azimuth → elevation angle) used for the "sun behind the ridge" time.                                     |
| `scripts/night-hikes/time.mjs`        | Timezone helpers for Cobb local dates and UTC instants.                                                                              |
| `scripts/night-hikes.config.json`     | Location, forecast length, display window, evening cutoff, full-moon window, and horizon definition.                                 |
| `package.json` / `package-lock.json`  | Build-only dependencies: `astronomy-engine` and `satellite.js`, plus the generator script.                                           |

## The almanac's rules

A night joins the almanac when at least one condition in `scripts/night-hikes/conditions.mjs`
matches:

1. **Big moon** — inside the configured full-moon window and above the horizon between sunset and
   the evening cutoff.
2. **Moonrise** — the moon rises between sunset and the evening cutoff and is more than half full.
3. **Bright Milky Way core** — the Sagittarius end is at least 10° up, with the moon down, for at
   least 20 minutes of the evening window.
4. **Meteor shower** — within one night of a peak, with the radiant at least 20° up and the moon set
   or below half.
5. **Satellite pass** — the ISS or Tiangong reaches 45° or more during the evening window, within
   the first 14 days after the build.
6. **Eclipse** — a visible lunar or solar eclipse. A solar eclipse is a daytime event but still
   counts, by club decree.
7. **Conjunction** — two planets within 3° of each other while both are up in the evening.

The thresholds live at the top of `conditions.mjs`. Adding or retiring a condition is one entry in
the `CONDITIONS` array; `generate.mjs` and the page do not need to change.

The knobs in `scripts/night-hikes.config.json` are location, forecast length, display window
(`displayWindowDays`, currently 14), evening cutoff, full-moon window, and the altitude that counts
as "above the horizon". The page shows every qualifying night in the next `displayWindowDays`
calendar days, counting the visitor's day as day one; the generator always writes every qualifying
night in the 90-day chart.

### Reasons and features

Each night in the JSON carries two lists:

- `reasons` — the conditions that matched, richest first. Each has an `id`, `label`, `priority`,
  `title`, `summary`, and optional `facts`. The page shows the first as the card headline, all of
  them as badges, and the rest as details.
- `features` — interesting things that did **not** necessarily make the night good: planets above
  8°, a moon-washed shower, a modest satellite pass, a wide planet pair. The page lists these under
  the reasons, skipping duplicates. The Milky Way appears here only when its bright core is up in
  the evening; the fainter outer band is still computed but is not shown on the page.

The full per-night sky record still lives in `sky.days`, so a feature can be promoted to a condition
later without regenerating anything that is not already there.

All instants in the JSON are UTC. The browser formats them in Cobb local time, and the calendar
dates in the JSON are Cobb local dates. The reason and feature summaries are pre-written in Cobb
local time so the page can print them as-is.

## The rest of the sky

For every day in the range, `sky-extras.mjs` stores:

- `darkStart` / `darkEnd` (astronomical dusk and dawn), `moonFreeStart` / `moonFreeEnd`.
- Milky Way (`milkyWay`): the all-night band window, the bright-core sub-object, and an `evening`
  sub-object restricted to sunset–evening cutoff; see below.
- `planets` above 8° at 9 PM, with altitude, compass direction, and illuminated fraction.
- `constellation` (the highest well-known one) and four `deepSky` targets above 12°.
- `goldenHour` / `blueHour` and the next `sunrise`.
- Moon phase, illumination, and the nearest full-moon name.

The page-level `sky` payload also carries new moons, full-moon names, meteor showers (radiant
altitude, moon interference, and a verdict), the next visible lunar and solar eclipses, close planet
pairs, the zodiacal-light season, and satellites grouped by local date in `sky.satellites.byDate`.

## Sunset behind the ridge

The club's viewpoint is above Cobb at 38.8253° N, 122.7025° W, about 987 m. Cobb Mountain sits 4–5
km west, so the sun often drops behind the ridge well before the open-sky sunset. Every day
therefore stores both `sunset` (the standard open-sky time) and `sunsetRidge` (when the sun's upper
limb crosses the local terrain). `sunsetRidge` is null when the ridge is too low to matter, as it is
in summer.

The ridge profile lives in `horizon.json`: geometric horizon angle for azimuths 220°–304° in 1°
steps, sampled at 0.5–25 km from a 30 m elevation model and committed so the build has no
terrain-data dependency. `sky-extras.mjs` interpolates the profile at the sun's azimuth and bisects
for the crossing, allowing for refraction and the sun's radius. If the configured location moves
more than about 100 m, the profile is ignored and the page falls back to the open-sky sunset.

## Milky Way rules

The Milky Way is a great circle, so half of it is always above the horizon; "the whole thing at
once" never happens. What changes is which half is up and how high it climbs. The generator
therefore reports two things:

- **Band window** (`milkyWay.from` / `to`): the band is sampled at twelve galactic longitudes, each
  weighted by how bright that part of the band is, with the core weighted most. A sample counts as
  visible above 5° and is fully counted by 30°. The window is the contiguous dark, moon-free stretch
  where that score stays within 0.08 of the night's best. This is kept in the data for future use;
  the page no longer shows the band, only the bright core.
- **Bright core** (`milkyWay.core`): the Sagittarius end, evaluated with a minimum altitude of 10°
  and a tolerance of 5° below its best usable altitude, and only while the moon is down. The core
  tops out around 22° from Cobb, so the edges of the window are only about 0.15 magnitudes dimmer
  than the middle — close enough that a whole window is a fair way to describe it.
- **Evening core** (`milkyWay.evening`): the same core rule restricted to sunset–evening cutoff. The
  almanac's **Bright Milky Way core** condition uses this one and asks for at least 20 minutes, so a
  core that is only peeking over the trees at 10 PM does not qualify the whole night.

In winter the core sets before the sky is dark, so the band window follows the outer arc (Cygnus,
Cassiopeia, Perseus) in the evening. In summer the core is the main event. Across a typical year,
the band has a usable moon-free window on roughly 80% of nights; the bright core is up on roughly
45% (February through October, peaking around May–September).

If the moon is up all night, both windows are reported as washed out by moonlight rather than
invented.

## Satellites and forecasts

- ISS, Tiangong, and Hubble passes are computed at build time from the latest TLEs with
  `satellite.js`. CelesTrak is the first source, with a small public mirror as a fallback when
  CelesTrak blocks or rate-limits the build. TLEs age, so the page calls the passes estimates; the
  three-day rebuild keeps the near-term passes fresh.
- The full range is propagated from one TLE snapshot and grouped by local date in
  `sky.satellites.byDate`. Only the first 14 days after the build can use a satellite pass as a
  good-night reason; later passes remain in the satellite panel as estimates, but do not qualify a
  night. The panel shows the first few passes per satellite.
- Sky steadiness and clarity come from the free 7Timer astronomy forecast, fetched at build time and
  stored as a 72-hour series in `sky.seeing`. The page picks the entry nearest 9 PM local for the
  current day. If the build is old enough that today is outside the series, it says no forecast is
  available rather than inventing one.

## Live conditions

`assets/js/night-hikes-conditions.js` asks Open-Meteo for cloud cover, temperature, wind, rain
chance, and PM2.5, and NOAA SWPC for the planetary K index. All three are free, CORS-enabled, and
need no key or backend. Requests are independent: if one fails, that row says "unavailable right
now" and the others still render. Nothing is cached or stored.

These are the only third-party requests the site makes at runtime apart from the `/intro` videos.
Sky steadiness is fetched from 7Timer at build time, not at runtime.

## Local development

The generator needs Node 26 or newer:

```bash
npm ci
npm run generate:night-hikes
```

`npm ci` is a one-time install (and again after `package-lock.json` changes). The generator writes
`assets/data/night-hikes.json` for the 90 days starting today in Cobb local time. The committed JSON
is enough for a normal `jekyll serve`; rerun the generator when you change
`scripts/night-hikes.config.json`, change the astronomy code, or want fresher dates.

Generate a different window when testing (for example, a summer chart to see the Milky Way core):

```bash
node scripts/night-hikes/generate.mjs --start=2027-06-15 --days=90
```

## Checks

```bash
npm run generate:night-hikes
node --check assets/js/night-hikes.js
node --check assets/js/night-hikes-conditions.js
node --check scripts/night-hikes/conditions.mjs
node --check scripts/night-hikes/sky-extras.mjs
prettier --check "assets/**/*.{css,js}" "scripts/**/*.mjs" "scripts/**/*.json" "package.json" "*.md" "_config.yml"
```

The generated `assets/data/night-hikes.json` is deliberately not on the Prettier list: it is
machine-written and large. The full site check (Jekyll build, `tidy`, Prettier) is in AGENTS.md.

## Content rules

- Keep the almanac's trail notes sensible: the moon is a mood, not a trail map, and the page should
  never imply that a calculated night is safe without a headlamp, a plan, and access checks.
- Satellite passes are the only estimate on the page. Keep the plain-language note and the inline
  `recheck` link (new tab, with the ↗ icon) to a pass prediction page for Cobb: Heavens-Above's
  per-satellite summary, or its daily list for the panel. Do not present them as certain.
- The almanac uses the MIT-licensed `astronomy-engine` and `satellite.js` at build time only, so no
  third-party JavaScript reaches the browser.
- Live weather/air/aurora are the runtime third-party fetches; sky steadiness is fetched at build
  time. Keep the fallbacks honest instead of inventing numbers.
