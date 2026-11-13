# Moon and Sun rise/set calculator

A standalone CLI for **real sunrise, sunset, moonrise, and moonset** at a specific point, taking the
surrounding hills into account. It is separate from the website build tooling in
`scripts/night-hikes/`.

It also prints the **official sea-level times** (flat horizon, no terrain) for comparison. It does
**not** account for trees, buildings, or weather — only the terrain in a public elevation model.

## Usage

From the repository root:

```bash
npm run moon-sun -- "38°49'10.7 N 122°41'55.4 W" --days 7
```

The seconds marker (`"`) is optional, so the coordinates can be written without it. That avoids
escaping double quotes inside the shell argument. The default timezone is `America/Los_Angeles`;
pass `--tz` for another place.

For one date:

```bash
npm run moon-sun -- "38°49'10.7 N 122°41'55.4 W" --start 2026-12-21 --days 1
```

Decimal coordinates also work:

```bash
npm run moon-sun -- "38.81964, -122.69872" --days 3
```

### Options

| Option               | Meaning                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `--tz TIMEZONE`      | IANA timezone for the output. Defaults to `America/Los_Angeles`.                            |
| `--days N`           | Number of days to print. Defaults to 7.                                                     |
| `--start YYYY-MM-DD` | First local date. Defaults to today in the chosen timezone.                                 |
| `--elevation METERS` | Ground elevation. If omitted, the elevation model supplies it.                              |
| `--azimuth-step DEG` | Terrain profile resolution. Defaults to 2°; use `1` for a finer profile (slower first run). |
| `--cache-dir PATH`   | Where to store the terrain profile. Defaults to `~/.cache/moon-sun-cli`.                    |
| `--refresh`          | Rebuild the cached terrain profile.                                                         |
| `--help`             | Show usage.                                                                                 |

## What it does

1. Parses Google Maps style degrees/minutes/seconds (or decimal degrees).
2. Looks up the ground elevation at the point.
3. Samples the surrounding terrain in every direction at distances from 0.5 km to 25 km, using the
   public OpenTopoData `srtm30m` elevation service.
4. Builds a horizon profile: the highest terrain angle in each azimuth, allowing for Earth
   curvature, standard atmospheric refraction, and a 1.7 m eye height.
5. Finds when the **upper limb** of the Sun or Moon crosses that local horizon. The ordinary
   flat-horizon rise/set is used only as a search anchor.
6. Separately prints the official sea-level rise/set (flat horizon, elevation 0) for comparison.

A profile is cached as JSON in `~/.cache/moon-sun-cli/` and reused, so a second run is fast. The
first run makes about 35 elevation requests at the default 2° resolution and takes roughly 45–60
seconds. A 1° profile makes about 69 requests. The service is free and needs no key; the script
retries rate limits and server errors.

## Output

```text
Location: 38.81964, -122.69872 (America/Los_Angeles)
Ground elevation: 980 m (terrain model); eye height: 1.7 m

Date        Terrain                               Official (sea level)
            Sunrise  Sunset   Moonrise Moonset    Sunrise  Sunset   Moonrise Moonset
2026-11-11  07:24    16:21    10:00    17:55      06:49    17:00    09:26    18:25
2026-11-12  07:24    16:21    10:52    18:47      06:50    16:59    10:18    19:18
```

A `—` means there is no rise or set above the terrain horizon on that local date.

## Limitations

- The elevation model is 30 m SRTM data; small ridges and nearby trees are not represented.
- The Moon’s angular radius is treated as a mean value.
- Weather and refraction beyond the standard model are not included.
- The default timezone is America/Los_Angeles; use `--tz` elsewhere.
- The elevation service is an external dependency. If it is unavailable, the cached profile still
  lets the script run.

## Maintenance

The code here is deliberately independent of the website’s `scripts/night-hikes` helpers. It shares
only the `astronomy-engine` dependency. If the site build tooling changes, this CLI should keep
working; update the terrain-sampling or display code here directly when needed.
