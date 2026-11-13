#!/usr/bin/env node

/*
 * Standalone terrain-aware rise/set calculator.
 *
 * This is intentionally independent of the website's night-hike build. It
 * samples a public elevation model, builds a local horizon profile, and prints
 * when the Sun and Moon actually clear that terrain.
 */

import { Body, Observer } from 'astronomy-engine';

import { officialRiseSet, terrainRiseSet } from './terrain-crossings.mjs';
import { buildHorizonProfile, parseCoordinates } from './terrain.mjs';
import { addDays, localDateString } from './time.mjs';

const USAGE = `Usage:
  npm run moon-sun -- "38°49'10.7 N 122°41'55.4 W" --days 7

The seconds marker is optional, so the coordinate string needs no escaped
double quotes. The default timezone is America/Los_Angeles.

Options:
  --tz TIMEZONE        IANA timezone for the output (default: America/Los_Angeles)
  --days N             Number of days to print (default: 7)
  --start YYYY-MM-DD   First local date (default: today)
  --elevation METERS   Ground elevation; otherwise looked up from the terrain model
  --azimuth-step DEG   Terrain profile resolution (default: 2; use 1 for finer)
  --cache-dir PATH     Where to cache terrain profiles
  --refresh            Ignore the cached terrain profile and rebuild it
  --help               Show this help

Prints terrain-aware times for the location and official sea-level times
(flat horizon, no terrain) for comparison.
`;

const SUN_RADIUS = 0.266;
const MOON_RADIUS = 0.259;
const EYE_HEIGHT = 1.7;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    timeZone: 'America/Los_Angeles',
    days: 7,
    start: null,
    elevationMeters: null,
    azimuthStep: 2,
    cacheDirectory: null,
    refresh: false,
    help: false,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (argument === '--refresh') {
      options.refresh = true;
      continue;
    }

    if (argument.startsWith('--')) {
      const [key, inlineValue] = argument.slice(2).split('=');
      const value = inlineValue ?? argv[index + 1];

      if (value === undefined) {
        fail(`Missing value for --${key}.`);
      }

      if (inlineValue === undefined) {
        index += 1;
      }

      switch (key) {
        case 'tz':
          options.timeZone = value;
          break;
        case 'days':
          options.days = Number(value);
          break;
        case 'start':
          options.start = value;
          break;
        case 'elevation':
          options.elevationMeters = Number(value);
          break;
        case 'azimuth-step':
          options.azimuthStep = Number(value);
          break;
        case 'cache-dir':
          options.cacheDirectory = value;
          break;
        default:
          fail(`Unknown option --${key}.`);
      }

      continue;
    }

    positional.push(argument);
  }

  options.coordinates = positional.join(' ');

  if (!options.help && options.coordinates.trim() === '') {
    fail('A latitude and longitude are required.');
  }

  if (!Number.isInteger(options.days) || options.days < 1) {
    fail('--days must be a positive integer.');
  }

  if (
    !Number.isInteger(options.azimuthStep) ||
    options.azimuthStep < 1 ||
    options.azimuthStep > 10
  ) {
    fail('--azimuth-step must be an integer from 1 to 10.');
  }

  if (options.elevationMeters !== null && !Number.isFinite(options.elevationMeters)) {
    fail('--elevation must be a number in meters.');
  }

  if (options.start !== null && !/^\d{4}-\d{2}-\d{2}$/.test(options.start)) {
    fail('--start must look like YYYY-MM-DD.');
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: options.timeZone }).format(new Date());
  } catch {
    fail(`Unknown timezone "${options.timeZone}". Use an IANA name such as America/Los_Angeles.`);
  }

  return options;
}

function formatTime(date, timeZone) {
  if (date === null) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function officialTimes(date, timeZone, observer) {
  return {
    sunrise: officialRiseSet({
      body: Body.Sun,
      date,
      timeZone,
      observer,
      direction: +1,
    }),
    sunset: officialRiseSet({
      body: Body.Sun,
      date,
      timeZone,
      observer,
      direction: -1,
    }),
    moonrise: officialRiseSet({
      body: Body.Moon,
      date,
      timeZone,
      observer,
      direction: +1,
    }),
    moonset: officialRiseSet({
      body: Body.Moon,
      date,
      timeZone,
      observer,
      direction: -1,
    }),
  };
}

function terrainTimes(date, timeZone, observer, profile) {
  return {
    sunrise: terrainRiseSet({
      body: Body.Sun,
      radius: SUN_RADIUS,
      date,
      timeZone,
      observer,
      profile,
      direction: +1,
    }),
    sunset: terrainRiseSet({
      body: Body.Sun,
      radius: SUN_RADIUS,
      date,
      timeZone,
      observer,
      profile,
      direction: -1,
    }),
    moonrise: terrainRiseSet({
      body: Body.Moon,
      radius: MOON_RADIUS,
      date,
      timeZone,
      observer,
      profile,
      direction: +1,
    }),
    moonset: terrainRiseSet({
      body: Body.Moon,
      radius: MOON_RADIUS,
      date,
      timeZone,
      observer,
      profile,
      direction: -1,
    }),
  };
}

function printRows(rows, timeZone) {
  const pad = (value) => value.padEnd(9);

  console.log('Date        ' + 'Terrain'.padEnd(38) + 'Official (sea level)');
  console.log(
    '            ' +
      'Sunrise  Sunset   Moonrise Moonset '.padEnd(38) +
      'Sunrise  Sunset   Moonrise Moonset',
  );

  for (const row of rows) {
    console.log(
      `${row.date}  ` +
        `${pad(formatTime(row.terrain.sunrise, timeZone))}` +
        `${pad(formatTime(row.terrain.sunset, timeZone))}` +
        `${pad(formatTime(row.terrain.moonrise, timeZone))}` +
        `${pad(formatTime(row.terrain.moonset, timeZone))}` +
        '  ' +
        `${pad(formatTime(row.official.sunrise, timeZone))}` +
        `${pad(formatTime(row.official.sunset, timeZone))}` +
        `${pad(formatTime(row.official.moonrise, timeZone))}` +
        `${formatTime(row.official.moonset, timeZone)}`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const { latitude, longitude } = parseCoordinates(options.coordinates);

  console.error(
    `Calculating terrain horizon for ${latitude.toFixed(5)}, ${longitude.toFixed(5)}...`,
  );

  const profile = await buildHorizonProfile({
    latitude,
    longitude,
    elevationMeters: options.elevationMeters,
    azimuthStep: options.azimuthStep,
    cacheDirectory: options.cacheDirectory || undefined,
    refresh: options.refresh,
    log: (message) => console.error(message),
  });
  const terrainObserver = new Observer(latitude, longitude, profile.elevationMeters);
  const officialObserver = new Observer(latitude, longitude, 0);
  const start = options.start || localDateString(new Date(), options.timeZone);
  const elevationLabel = options.elevationMeters === null ? 'terrain model' : 'given';
  const dates = Array.from({ length: options.days }, (_, offset) => addDays(start, offset));
  const rows = dates.map((date) => ({
    date,
    terrain: terrainTimes(date, options.timeZone, terrainObserver, profile),
    official: officialTimes(date, options.timeZone, officialObserver),
  }));

  console.log(`Location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (${options.timeZone})`);
  console.log(
    `Ground elevation: ${profile.elevationMeters.toFixed(0)} m (${elevationLabel}); eye height: ${EYE_HEIGHT} m`,
  );
  console.log('');
  printRows(rows, options.timeZone);
  console.log('');
  console.log(
    'Terrain times use the local ridge; official times ignore terrain and use sea level.',
  );
  console.log('Trees, buildings, and weather are not included.');
}

try {
  await main();
} catch (error) {
  console.error(`moon-sun-cli: ${error.message}`);
  process.exitCode = 1;
}
