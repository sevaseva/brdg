/*
 * Extra sky material for the night-hike almanac.
 *
 * Everything in here is either computed at build time (astronomy), fetched as a
 * short forecast, or labelled as an estimate. The goal is to keep the page
 * honest: a value that depends on weather, orbits, or a service should never
 * pretend to be more certain than it is.
 */

import {
  AstroTime,
  Body,
  Equator,
  Horizon,
  Illumination,
  MoonPhase,
  NextLunarEclipse,
  SearchAltitude,
  SearchLocalSolarEclipse,
  SearchMoonPhase,
  SearchSunLongitude,
} from 'astronomy-engine';
import * as satellite from 'satellite.js';
import fs from 'node:fs';

import { moonAltitude, sunsetOn, sunriseOn } from './sky.mjs';
import { addDays, localDateString, zonedTimeToUtc } from './time.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const HORIZON_PROFILE = JSON.parse(
  fs.readFileSync(new URL('./horizon.json', import.meta.url), 'utf8'),
);

const GALACTIC_CENTER = { ra: 17.7611, dec: -29.0078 };
const MILKY_WAY_MIN_ALTITUDE = 10;
const MILKY_WAY_TOLERANCE = 5;
const MILKY_WAY_SCORE_TOLERANCE = 0.08;
const MILKY_WAY_MIN_SCORE = 0.22;

/* J2000 north galactic pole and the galactic longitude of the north celestial pole. */
const GALACTIC_NGP = { raDegrees: 192.85948, decDegrees: 27.12825, lNcp: 122.93192 };

/**
 * Convert galactic coordinates (degrees) to equatorial J2000. The Milky Way
 * band is sampled along b = 0, so we only ever need the plane.
 */
function galacticToEquatorial(longitudeDegrees, latitudeDegrees = 0) {
  const toRad = Math.PI / 180;
  const l = longitudeDegrees * toRad;
  const b = latitudeDegrees * toRad;
  const poleDec = GALACTIC_NGP.decDegrees * toRad;
  const lNcp = GALACTIC_NGP.lNcp * toRad;

  const sinDec =
    Math.sin(poleDec) * Math.sin(b) + Math.cos(poleDec) * Math.cos(b) * Math.cos(lNcp - l);
  const dec = Math.asin(Math.min(1, Math.max(-1, sinDec))) / toRad;
  const y = Math.cos(b) * Math.sin(lNcp - l);
  const x = Math.cos(poleDec) * Math.sin(b) - Math.sin(poleDec) * Math.cos(b) * Math.cos(lNcp - l);
  const ra = (((GALACTIC_NGP.raDegrees + Math.atan2(y, x) / toRad) % 360) + 360) % 360;

  return { ra: ra / 15, dec };
}

/**
 * How bright the galactic equator is, relative to the core, at a given
 * galactic longitude. The Sagittarius/Scutum end is the bright heart; Cygnus
 * and the Cassiopeia/Perseus arc are still generous; the outer band is faint.
 */
function bandWeight(longitude) {
  const distance = Math.abs(((longitude + 180) % 360) - 180);

  if (distance <= 35) {
    return 1;
  }

  if (distance <= 75) {
    return 0.8;
  }

  if (distance <= 115) {
    return 0.6;
  }

  if (distance <= 155) {
    return 0.45;
  }

  return 0.35;
}

/* Twelve points every 30° of galactic longitude, enough to know how the band sits. */
const MILKY_WAY_BAND = Array.from({ length: 12 }, (_, index) => {
  const longitude = index * 30;
  const weight = bandWeight(longitude);

  return { longitude, weight, ...galacticToEquatorial(longitude) };
});

/**
 * Fraction of the band's light that is high enough to see, 0..1. Below 5° the
 * horizon haze wins; by 30° the band is as good as it is going to get.
 */
function bandVisibility(altitude) {
  if (altitude <= 5) {
    return 0;
  }

  if (altitude >= 30) {
    return 1;
  }

  return (altitude - 5) / 25;
}

export function milkyWayBandScore(date, observer) {
  let visible = 0;
  let total = 0;

  for (const point of MILKY_WAY_BAND) {
    visible += point.weight * bandVisibility(altitudeOf(point.ra, point.dec, date, observer));
    total += point.weight;
  }

  return visible / total;
}

const PLANETS = [
  ['Mercury', Body.Mercury],
  ['Venus', Body.Venus],
  ['Mars', Body.Mars],
  ['Jupiter', Body.Jupiter],
  ['Saturn', Body.Saturn],
  ['Uranus', Body.Uranus],
  ['Neptune', Body.Neptune],
];

const DEEP_SKY = [
  {
    name: 'Andromeda Galaxy',
    catalog: 'M31',
    ra: 0.712,
    dec: 41.269,
    type: 'galaxy',
    note: 'A faint smudge to the naked eye; binoculars make it obvious.',
  },
  {
    name: 'Orion Nebula',
    catalog: 'M42',
    ra: 5.588,
    dec: -5.39,
    type: 'nebula',
    note: 'The middle “star” in Orion’s sword. Best in winter.',
  },
  {
    name: 'Pleiades',
    catalog: 'M45',
    ra: 3.79,
    dec: 24.117,
    type: 'cluster',
    note: 'The Seven Sisters; lovely in binoculars and unaided eyes.',
  },
  {
    name: 'Hercules Cluster',
    catalog: 'M13',
    ra: 16.695,
    dec: 36.46,
    type: 'cluster',
    note: 'A globular cluster; a small telescope turns it into a ball of stars.',
  },
  {
    name: 'Lagoon Nebula',
    catalog: 'M8',
    ra: 18.06,
    dec: -24.383,
    type: 'nebula',
    note: 'A summer favourite in Sagittarius, low from Cobb.',
  },
  {
    name: 'Ring Nebula',
    catalog: 'M57',
    ra: 18.893,
    dec: 33.029,
    type: 'planetary nebula',
    note: 'A tiny smoke ring; needs a telescope and steady air.',
  },
  {
    name: 'Dumbbell Nebula',
    catalog: 'M27',
    ra: 19.993,
    dec: 22.721,
    type: 'planetary nebula',
    note: 'A bright planetary nebula in Vulpecula; a good first target.',
  },
  {
    name: 'Double Cluster',
    catalog: 'NGC 869/884',
    ra: 2.317,
    dec: 57.133,
    type: 'cluster',
    note: 'Two open clusters side by side in Perseus.',
  },
  {
    name: 'Triangulum Galaxy',
    catalog: 'M33',
    ra: 1.564,
    dec: 30.66,
    type: 'galaxy',
    note: 'Large and faint; wants a dark sky and a wide eyepiece.',
  },
  {
    name: 'Bode’s Galaxy',
    catalog: 'M81',
    ra: 9.926,
    dec: 69.065,
    type: 'galaxy',
    note: 'A bright galaxy near Ursa Major, visible in binoculars from dark sites.',
  },
];

const CONSTELLATIONS = [
  {
    name: 'Orion',
    ra: 5.5,
    dec: 0,
    story:
      'The hunter, with a belt of three stars and a sword hanging below it. Winter’s easiest landmark.',
  },
  {
    name: 'Taurus',
    ra: 4.5,
    dec: 18,
    story: 'The bull, with the V-shaped Hyades for a face and the Pleiades on his shoulder.',
  },
  {
    name: 'Perseus',
    ra: 3.5,
    dec: 45,
    story:
      'The hero who rescued Andromeda. In autumn he rises in the northeast with the Double Cluster.',
  },
  {
    name: 'Cassiopeia',
    ra: 1,
    dec: 60,
    story: 'A lazy W of five bright stars, circling the pole and never setting from Cobb.',
  },
  {
    name: 'Cygnus',
    ra: 20.5,
    dec: 42,
    story:
      'The swan, flying down the Milky Way. Deneb is one of the most luminous stars we can see.',
  },
  {
    name: 'Lyra',
    ra: 18.8,
    dec: 37,
    story: 'A small parallelogram anchored by Vega, the bright blue-white summer star.',
  },
  {
    name: 'Aquila',
    ra: 19.7,
    dec: 3,
    story: 'The eagle, with Altair flanked by two fainter stars in a short straight line.',
  },
  {
    name: 'Pegasus',
    ra: 22.7,
    dec: 20,
    story: 'The winged horse; its Great Square is a handy autumn signpost.',
  },
  {
    name: 'Andromeda',
    ra: 0.8,
    dec: 38,
    story: 'The princess, chained to a rock and rescued at the last minute. Home of M31.',
  },
  {
    name: 'Leo',
    ra: 10.5,
    dec: 15,
    story: 'The lion, with a backwards question mark for a mane. A spring constellation.',
  },
  {
    name: 'Scorpius',
    ra: 16.8,
    dec: -30,
    story: 'The scorpion, low in the south on summer evenings. Antares is its red heart.',
  },
  {
    name: 'Sagittarius',
    ra: 19,
    dec: -25,
    story: 'The teapot-shaped archer, pointing toward the centre of the Milky Way.',
  },
  {
    name: 'Ursa Major',
    ra: 11,
    dec: 55,
    story: 'The Great Bear. The Big Dipper’s bowl points at Polaris, the North Star.',
  },
  {
    name: 'Gemini',
    ra: 7,
    dec: 22,
    story: 'The twins Castor and Pollux, two bright stars side by side in winter.',
  },
  {
    name: 'Auriga',
    ra: 6,
    dec: 42,
    story: 'The charioteer, a pentagon of stars with Capella shining at one corner.',
  },
];

const METEOR_SHOWERS = [
  {
    name: 'Quadrantids',
    month: 1,
    day: 3,
    solarLongitude: 283.2,
    ra: 230,
    dec: 49,
    zhr: 110,
  },
  {
    name: 'Lyrids',
    month: 4,
    day: 22,
    solarLongitude: 32.4,
    ra: 271,
    dec: 34,
    zhr: 18,
  },
  {
    name: 'Eta Aquariids',
    month: 5,
    day: 6,
    solarLongitude: 45.5,
    ra: 338,
    dec: -1,
    zhr: 50,
  },
  {
    name: 'Delta Aquariids',
    month: 7,
    day: 30,
    solarLongitude: 125,
    ra: 340,
    dec: -16,
    zhr: 25,
  },
  {
    name: 'Perseids',
    month: 8,
    day: 12,
    solarLongitude: 140,
    ra: 48,
    dec: 58,
    zhr: 100,
  },
  {
    name: 'Draconids',
    month: 10,
    day: 8,
    solarLongitude: 195.4,
    ra: 263,
    dec: 54,
    zhr: 10,
  },
  {
    name: 'Orionids',
    month: 10,
    day: 21,
    solarLongitude: 208,
    ra: 95,
    dec: 16,
    zhr: 20,
  },
  {
    name: 'Southern Taurids',
    month: 11,
    day: 5,
    solarLongitude: 223,
    ra: 52,
    dec: 13,
    zhr: 5,
  },
  {
    name: 'Leonids',
    month: 11,
    day: 17,
    solarLongitude: 235,
    ra: 152,
    dec: 22,
    zhr: 15,
  },
  {
    name: 'Geminids',
    month: 12,
    day: 14,
    solarLongitude: 262.2,
    ra: 112,
    dec: 33,
    zhr: 150,
  },
  {
    name: 'Ursids',
    month: 12,
    day: 22,
    solarLongitude: 270,
    ra: 217,
    dec: 76,
    zhr: 10,
  },
];

const FULL_MOON_NAMES = [
  'Wolf Moon',
  'Snow Moon',
  'Worm Moon',
  'Pink Moon',
  'Flower Moon',
  'Strawberry Moon',
  'Buck Moon',
  'Sturgeon Moon',
  'Harvest Moon',
  'Hunter’s Moon',
  'Beaver Moon',
  'Cold Moon',
];

function round(value, places = 1) {
  const factor = 10 ** places;

  return Math.round(value * factor) / factor;
}

function iso(date) {
  return new Date(date).toISOString();
}

function compass(azimuth) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  return directions[Math.round(azimuth / 45) % 8];
}

function altitudeOf(ra, dec, date, observer) {
  return Horizon(new AstroTime(date), observer, ra, dec, 'normal').altitude;
}

function bodyHorizon(body, date, observer) {
  const equator = Equator(body, new AstroTime(date), observer, true, true);

  return Horizon(new AstroTime(date), observer, equator.ra, equator.dec, 'normal');
}

/*
 * Local ridge profile. The profile is committed because it was sampled once
 * from a 30 m elevation model; it is ignored if the configured location has
 * moved, so the almanac quietly falls back to the open-sky sunset.
 */
function horizonProfileFor(observer) {
  const profile = HORIZON_PROFILE;

  if (
    Math.abs(profile.latitude - observer.latitude) > 0.001 ||
    Math.abs(profile.longitude - observer.longitude) > 0.001 ||
    Math.abs(profile.elevationMeters - observer.height) > 15
  ) {
    return null;
  }

  return profile;
}

function ridgeElevation(profile, azimuth) {
  const azis = profile.azimuths;
  const angle = ((azimuth % 360) + 360) % 360;

  if (angle < azis[0] || angle > azis[azis.length - 1]) {
    return null;
  }

  for (let index = 0; index < azis.length - 1; index += 1) {
    if (angle >= azis[index] && angle <= azis[index + 1]) {
      const ratio = (angle - azis[index]) / (azis[index + 1] - azis[index]);

      return profile.elevations[index] * (1 - ratio) + profile.elevations[index + 1] * ratio;
    }
  }

  return null;
}

function refractionDegrees(altitude) {
  const h = Math.max(altitude, -1);

  return 1.02 / Math.tan(((h + 10.3 / (h + 5.11)) * Math.PI) / 180) / 60;
}

/*
 * The moment the sun's upper limb drops behind the local ridge. This is
 * separate from the open-sky sunset: in winter the sun goes behind Cobb
 * Mountain half an hour early; in summer the ridge is too low to matter.
 */
function terrainSunset(sunset, observer, profile) {
  if (!profile || sunset === null) {
    return null;
  }

  const start = sunset.getTime() - 100 * MINUTE_MS;
  const end = sunset.getTime() + 5 * MINUTE_MS;
  const difference = (time) => {
    const sun = bodyHorizon(Body.Sun, new Date(time), observer);
    const ridge = ridgeElevation(profile, sun.azimuth);

    if (ridge === null) {
      return null;
    }

    return sun.altitude + 0.266 - (ridge + refractionDegrees(ridge));
  };
  const startValue = difference(start);
  const endValue = difference(end);

  if (startValue === null || endValue === null || startValue <= 0 || endValue >= 0) {
    return null;
  }

  let low = start;
  let high = end;

  for (let index = 0; index < 40; index += 1) {
    const middle = (low + high) / 2;
    const value = difference(middle);

    if (value === null) {
      return null;
    }

    if (value > 0) {
      low = middle;
    } else {
      high = middle;
    }
  }

  const result = new Date((low + high) / 2);
  const atResult = bodyHorizon(Body.Sun, result, observer);
  const ridge = ridgeElevation(profile, atResult.azimuth);

  if (ridge === null || ridge < 0.5) {
    return null;
  }

  return result;
}

function angularSeparation(ra1, dec1, ra2, dec2) {
  const toRad = Math.PI / 180;
  const cosine =
    Math.sin(dec1 * toRad) * Math.sin(dec2 * toRad) +
    Math.cos(dec1 * toRad) * Math.cos(dec2 * toRad) * Math.cos((ra1 - ra2) * 15 * toRad);

  return Math.acos(Math.min(1, Math.max(-1, cosine))) / toRad;
}

function phaseName(angle) {
  const names = [
    'New moon',
    'Waxing crescent',
    'First quarter',
    'Waxing gibbous',
    'Full moon',
    'Waning gibbous',
    'Last quarter',
    'Waning crescent',
  ];

  return names[Math.round(angle / 45) % 8];
}

function nearestFullMoonName(date, fullMoons, timezone) {
  let best = null;
  const target = Date.parse(`${date}T12:00:00Z`);

  for (const fullMoon of fullMoons) {
    const difference = Math.abs(
      Date.parse(`${localDateString(fullMoon, timezone)}T00:00:00Z`) - target,
    );

    if (best === null || difference < best.difference) {
      best = { difference, month: Number(localDateString(fullMoon, timezone).slice(5, 7)) };
    }
  }

  return best ? FULL_MOON_NAMES[best.month - 1] : null;
}

function visiblePlanets(date, observer) {
  const planets = [];

  for (const [name, body] of PLANETS) {
    const horizon = bodyHorizon(body, date, observer);

    if (horizon.altitude < 8) {
      continue;
    }

    const illumination = Illumination(body, date);

    planets.push({
      name,
      altitude: round(horizon.altitude),
      azimuth: round(horizon.azimuth),
      direction: compass(horizon.azimuth),
      phase: round(illumination.phase_fraction, 2),
    });
  }

  return planets.sort((left, right) => right.altitude - left.altitude);
}

function moonFreeWindow(darkStart, darkEnd, observer) {
  let best = null;
  let runStart = null;
  const step = 5 * MINUTE_MS;

  for (let time = darkStart; time <= darkEnd; time += step) {
    const isFree = moonAltitude(new Date(time), observer) < -0.25;

    if (isFree && runStart === null) {
      runStart = time;
    }

    if (!isFree && runStart !== null) {
      if (best === null || time - runStart > best.end - best.start) {
        best = { start: runStart, end: time };
      }

      runStart = null;
    }
  }

  if (runStart !== null && (best === null || darkEnd - runStart > best.end - best.start)) {
    best = { start: runStart, end: darkEnd };
  }

  return best;
}

/*
 * The Milky Way's bright core sits in Sagittarius, so its altitude is the
 * thing worth reporting. From Cobb it never climbs above about 22°, and near
 * that highest point the altitude changes slowly: half an hour either side
 * costs a fraction of a degree, an hour about 1.5°, two hours about 5.5°.
 * Atmospheric extinction over that last step is only ~0.15 magnitudes, so the
 * useful window is wide. We call it good while the core is within 5° of its
 * best usable altitude, at least 10° up, and the moon is down.
 */
function coreWindow(samples) {
  const peak = samples.reduce(
    (best, sample) => (best === null || sample.coreAltitude > best.coreAltitude ? sample : best),
    null,
  );

  if (peak === null || peak.coreAltitude < MILKY_WAY_MIN_ALTITUDE) {
    return {
      visible: false,
      reason: peak !== null && peak.coreAltitude > 0 ? 'low' : 'season',
      altitude: peak === null ? 0 : round(peak.coreAltitude),
    };
  }

  let best = null;

  for (const sample of samples) {
    if (
      sample.moonFree &&
      sample.coreAltitude >= MILKY_WAY_MIN_ALTITUDE &&
      (best === null || sample.coreAltitude > best.coreAltitude)
    ) {
      best = sample;
    }
  }

  if (best === null) {
    return { visible: false, reason: 'moonlight', altitude: round(peak.coreAltitude) };
  }

  const threshold = Math.max(MILKY_WAY_MIN_ALTITUDE, best.coreAltitude - MILKY_WAY_TOLERANCE);
  const index = samples.indexOf(best);
  let from = index;
  let to = index;

  while (from > 0 && samples[from - 1].moonFree && samples[from - 1].coreAltitude >= threshold) {
    from -= 1;
  }

  while (
    to < samples.length - 1 &&
    samples[to + 1].moonFree &&
    samples[to + 1].coreAltitude >= threshold
  ) {
    to += 1;
  }

  return {
    visible: true,
    best: iso(new Date(best.time)),
    altitude: round(best.coreAltitude),
    from: iso(new Date(samples[from].time)),
    to: iso(new Date(samples[to].time)),
  };
}

/*
 * The Milky Way is a great circle, so half of it is above the horizon at any
 * moment; "the whole thing at once" never happens. What changes is which half
 * is up and how high it climbs. We score the band by how much of its light is
 * above the useful altitude, weight the bright core more heavily, and treat a
 * stretch as good while that score stays close to its best.
 */
export function milkyWayWindow(darkStart, darkEnd, observer) {
  const samples = [];

  for (let time = darkStart; time <= darkEnd; time += 5 * MINUTE_MS) {
    const when = new Date(time);

    samples.push({
      time,
      coreAltitude: altitudeOf(GALACTIC_CENTER.ra, GALACTIC_CENTER.dec, when, observer),
      bandScore: milkyWayBandScore(when, observer),
      moonFree: moonAltitude(when, observer) < -0.25,
    });
  }

  const core = coreWindow(samples);
  let best = null;

  for (const sample of samples) {
    if (sample.moonFree && (best === null || sample.bandScore > best.bandScore)) {
      best = sample;
    }
  }

  if (best === null) {
    return { visible: false, reason: 'moonlight', core, bandScore: 0 };
  }

  if (best.bandScore < MILKY_WAY_MIN_SCORE) {
    return { visible: false, reason: 'low', core, bandScore: round(best.bandScore, 2) };
  }

  const threshold = best.bandScore - MILKY_WAY_SCORE_TOLERANCE;
  const index = samples.indexOf(best);
  let from = index;
  let to = index;

  while (from > 0 && samples[from - 1].moonFree && samples[from - 1].bandScore >= threshold) {
    from -= 1;
  }

  while (
    to < samples.length - 1 &&
    samples[to + 1].moonFree &&
    samples[to + 1].bandScore >= threshold
  ) {
    to += 1;
  }

  return {
    visible: true,
    best: iso(new Date(best.time)),
    bandScore: round(best.bandScore, 2),
    from: iso(new Date(samples[from].time)),
    to: iso(new Date(samples[to].time)),
    core,
  };
}

function pickConstellation(date, observer) {
  let best = null;

  for (const constellation of CONSTELLATIONS) {
    const altitude = altitudeOf(constellation.ra, constellation.dec, date, observer);

    if (altitude > 15 && (best === null || altitude > best.altitude)) {
      best = {
        name: constellation.name,
        story: constellation.story,
        altitude: round(altitude),
      };
    }
  }

  return best;
}

function pickDeepSky(date, observer) {
  return DEEP_SKY.map((target) => ({
    name: target.name,
    catalog: target.catalog,
    type: target.type,
    note: target.note,
    altitude: round(altitudeOf(target.ra, target.dec, date, observer)),
  }))
    .filter((target) => target.altitude > 12)
    .sort((left, right) => right.altitude - left.altitude)
    .slice(0, 4);
}

function milkyWayEvening(sunset, windowEnd, observer) {
  const samples = [];

  for (let time = sunset.getTime(); time <= windowEnd; time += 5 * MINUTE_MS) {
    const when = new Date(time);

    samples.push({
      time,
      coreAltitude: altitudeOf(GALACTIC_CENTER.ra, GALACTIC_CENTER.dec, when, observer),
      moonFree: moonAltitude(when, observer) < -0.25,
    });
  }

  return coreWindow(samples);
}

function buildDay(date, context) {
  const { timezone, observer, fullMoons, eveningEnd } = context;
  const sunset = sunsetOn(date, timezone, observer);

  if (sunset === null) {
    return null;
  }

  const sunsetRidge = terrainSunset(sunset, observer, horizonProfileFor(observer));

  const nextDate = addDays(date, 1);
  const sunrise = sunriseOn(nextDate, timezone, observer);
  const nextMidnight = zonedTimeToUtc(nextDate, 0, 0, timezone);

  const dusk = {};
  for (const [key, altitude] of [
    ['civil', -6],
    ['nautical', -12],
    ['astronomical', -18],
  ]) {
    const event = SearchAltitude(Body.Sun, observer, -1, sunset, 1.5, altitude);

    dusk[key] = event === null ? null : event.date;
  }

  const dawnEvent = SearchAltitude(Body.Sun, observer, +1, nextMidnight, 1.5, -18);
  const darkStart = (dusk.astronomical || dusk.nautical || dusk.civil || sunset).getTime();
  const darkEnd = (dawnEvent === null ? sunrise || nextMidnight : dawnEvent.date).getTime();

  if (darkEnd <= darkStart) {
    return null;
  }

  const moonFree = moonFreeWindow(darkStart, darkEnd, observer);
  const milkyWay = milkyWayWindow(darkStart, darkEnd, observer);
  const windowEnd = zonedTimeToUtc(date, eveningEnd.hour, eveningEnd.minute, timezone).getTime();
  const sampleMs = Math.min(
    Math.max(zonedTimeToUtc(date, 21, 0, timezone).getTime(), darkStart),
    darkEnd,
  );
  const sampleDate = new Date(sampleMs);

  const moonPhaseAngle = MoonPhase(sampleDate);
  const moonIllum = Illumination(Body.Moon, sampleDate).phase_fraction;

  const goldenStart = SearchAltitude(
    Body.Sun,
    observer,
    -1,
    zonedTimeToUtc(date, 12, 0, timezone),
    1.5,
    6,
  );
  const goldenEnd =
    goldenStart === null ? null : SearchAltitude(Body.Sun, observer, -1, goldenStart.date, 1.5, -4);
  const blueEnd =
    goldenEnd === null ? null : SearchAltitude(Body.Sun, observer, -1, goldenEnd.date, 1.5, -6);

  return {
    date,
    sunset: iso(sunset),
    sunsetRidge: sunsetRidge === null ? null : iso(sunsetRidge),
    sunrise: sunrise === null ? null : iso(sunrise),
    darkStart: iso(darkStart),
    darkEnd: iso(darkEnd),
    civilDusk: dusk.civil === null ? null : iso(dusk.civil),
    nauticalDusk: dusk.nautical === null ? null : iso(dusk.nautical),
    moonFreeStart: moonFree === null ? null : iso(moonFree.start),
    moonFreeEnd: moonFree === null ? null : iso(moonFree.end),
    milkyWay: { ...milkyWay, evening: milkyWayEvening(sunset, windowEnd, observer) },
    planets: visiblePlanets(sampleDate, observer),
    moon: {
      phase: phaseName(moonPhaseAngle),
      illumination: round(moonIllum, 3),
      name: nearestFullMoonName(date, fullMoons, timezone),
    },
    goldenHour: {
      start: goldenStart === null ? null : iso(goldenStart.date),
      end: goldenEnd === null ? null : iso(goldenEnd.date),
    },
    blueHour: {
      start: goldenEnd === null ? null : iso(goldenEnd.date),
      end: blueEnd === null ? null : iso(blueEnd.date),
    },
    constellation: pickConstellation(sampleDate, observer),
    deepSky: pickDeepSky(sampleDate, observer),
  };
}

function newMoonsBetween(startMs, endMs) {
  const moons = [];
  let cursor = new AstroTime(new Date(startMs));

  while (cursor.date.getTime() < endMs) {
    const moon = SearchMoonPhase(0, cursor, 40);

    if (moon === null || moon.date.getTime() > endMs) {
      break;
    }

    moons.push(moon.date);
    cursor = new AstroTime(new Date(moon.date.getTime() + DAY_MS));
  }

  return moons;
}

function showerPeak(shower, year) {
  const estimate = new Date(Date.UTC(year, shower.month - 1, shower.day, 12));
  const start = new Date(estimate.getTime() - 12 * DAY_MS);

  return SearchSunLongitude(shower.solarLongitude, start, 30);
}

function buildMeteorShowers(startMs, endMs, timezone, observer) {
  const startYear = new Date(startMs).getUTCFullYear();
  const showers = [];

  for (const shower of METEOR_SHOWERS) {
    for (const year of [startYear, startYear + 1]) {
      const peak = showerPeak(shower, year);

      if (peak === null) {
        continue;
      }

      const peakMs = peak.date.getTime();

      if (peakMs < startMs - 2 * DAY_MS || peakMs > endMs + 14 * DAY_MS) {
        continue;
      }

      const localDate = localDateString(peak.date, timezone);
      const localHour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: 'numeric',
          hour12: false,
        }).format(peak.date),
      );
      // The peak instant is often in daylight. Look through the dark hours
      // around it and report when the radiant is highest.
      const observingDate = localHour < 2 ? localDate : addDays(localDate, 1);
      let best = null;

      for (const hour of [20, 22, 0, 2, 4, 6]) {
        const date = hour >= 12 ? addDays(observingDate, -1) : observingDate;
        const time = zonedTimeToUtc(date, hour, 0, timezone);
        const altitude = altitudeOf(shower.ra / 15, shower.dec, time, observer);

        if (best === null || altitude > best.altitude) {
          best = { time, altitude };
        }
      }

      const observing = best.time;
      const radiantAltitude = best.altitude;
      const moon = Illumination(Body.Moon, observing).phase_fraction;
      const moonAlt = moonAltitude(observing, observer);
      const timeLabel = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
      }).format(observing);

      let verdict = 'Fair';

      if (radiantAltitude < 10) {
        verdict = 'Poor';
      } else if (moon > 0.6 && moonAlt > 10) {
        verdict = 'Fair at best';
      } else if (radiantAltitude > 30 && moon < 0.4) {
        verdict = 'Good';
      }

      showers.push({
        name: shower.name,
        peak: iso(peak.date),
        localDate,
        bestTime: iso(observing),
        zhr: shower.zhr,
        radiantAltitude: round(radiantAltitude),
        moonIllumination: round(moon, 2),
        moonAltitude: round(moonAlt),
        verdict,
        note: `${shower.zhr}/hour under ideal skies. Meteors appear from a point ${Math.round(radiantAltitude)}° above the horizon around ${timeLabel}; moon ${Math.round(moon * 100)}% lit.`,
      });
    }
  }

  return showers
    .sort((left, right) => left.peak.localeCompare(right.peak))
    .filter((shower, index, all) => all.findIndex((other) => other.name === shower.name) === index);
}

function findLunarEclipse(startMs, timezone, observer) {
  let cursor = new Date(startMs);

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const eclipse = NextLunarEclipse(cursor);

    if (eclipse === null) {
      return null;
    }

    const moon = bodyHorizon(Body.Moon, eclipse.peak.date, observer);

    if (moon.altitude > 0) {
      return {
        kind: String(eclipse.kind),
        peak: iso(eclipse.peak.date),
        localDate: localDateString(eclipse.peak.date, timezone),
        altitude: round(moon.altitude),
        obscuration: round(eclipse.obscuration, 2),
        visible: true,
        note: 'The Moon is above the horizon at peak from Cobb.',
      };
    }

    cursor = new Date(eclipse.peak.date.getTime() + 25 * DAY_MS);
  }

  return null;
}

function findSolarEclipse(startMs, timezone, observer) {
  let cursor = new Date(startMs);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const eclipse = SearchLocalSolarEclipse(cursor, observer);

    if (eclipse === null) {
      return null;
    }

    const peak = eclipse.peak.time.date;
    const obscuration = eclipse.obscuration === undefined ? 0 : eclipse.obscuration;

    if (eclipse.peak.altitude > 0 && obscuration > 0.02) {
      return {
        kind: String(eclipse.kind),
        peak: iso(peak),
        localDate: localDateString(peak, timezone),
        altitude: round(eclipse.peak.altitude),
        obscuration: round(obscuration, 2),
        visible: true,
        note: 'The Sun is above the horizon at peak from Cobb.',
      };
    }

    cursor = new Date(peak.getTime() + 40 * DAY_MS);
  }

  return null;
}

function buildConjunctions(startDate, days, timezone, observer) {
  const pairs = [];
  const bodies = [
    ['Mercury', Body.Mercury],
    ['Venus', Body.Venus],
    ['Mars', Body.Mars],
    ['Jupiter', Body.Jupiter],
    ['Saturn', Body.Saturn],
  ];

  const scanDays = Math.max(120, days + 30);

  for (let first = 0; first < bodies.length; first += 1) {
    for (let second = first + 1; second < bodies.length; second += 1) {
      let best = null;

      for (let day = 0; day < scanDays; day += 1) {
        const date = addDays(startDate, day);

        for (const hour of [18, 20, 22, 0, 2, 4]) {
          const time = zonedTimeToUtc(date, hour, 0, timezone);

          if (bodyHorizon(Body.Sun, time, observer).altitude > -6) {
            continue;
          }

          const one = bodyHorizon(bodies[first][1], time, observer);
          const two = bodyHorizon(bodies[second][1], time, observer);

          if (one.altitude < 5 || two.altitude < 5) {
            continue;
          }

          const equatorOne = Equator(bodies[first][1], new AstroTime(time), observer, true, true);
          const equatorTwo = Equator(bodies[second][1], new AstroTime(time), observer, true, true);
          const separation = angularSeparation(
            equatorOne.ra,
            equatorOne.dec,
            equatorTwo.ra,
            equatorTwo.dec,
          );

          if (best === null || separation < best.separation) {
            best = {
              date,
              time,
              separation,
              first: bodies[first][0],
              second: bodies[second][0],
              firstAltitude: one.altitude,
              secondAltitude: two.altitude,
              direction: compass((one.azimuth + two.azimuth) / 2),
            };
          }
        }
      }

      if (best !== null && best.separation < 5) {
        // The closest approach may be in the small hours. Record the best
        // evening view as well, because that is the club's walking window.
        let evening = null;

        for (const hour of [18, 19, 20, 21, 22]) {
          const time = zonedTimeToUtc(best.date, hour, 0, timezone);

          if (bodyHorizon(Body.Sun, time, observer).altitude > -6) {
            continue;
          }

          const one = bodyHorizon(bodies[first][1], time, observer);
          const two = bodyHorizon(bodies[second][1], time, observer);

          if (one.altitude < 5 || two.altitude < 5) {
            continue;
          }

          const equatorOne = Equator(bodies[first][1], new AstroTime(time), observer, true, true);
          const equatorTwo = Equator(bodies[second][1], new AstroTime(time), observer, true, true);
          const separation = angularSeparation(
            equatorOne.ra,
            equatorOne.dec,
            equatorTwo.ra,
            equatorTwo.dec,
          );

          if (evening === null || separation < evening.separation) {
            evening = {
              time,
              separation,
              altitude: Math.min(one.altitude, two.altitude),
              direction: compass((one.azimuth + two.azimuth) / 2),
            };
          }
        }

        pairs.push({ ...best, evening });
      }
    }
  }

  return pairs
    .sort((left, right) => left.time - right.time)
    .slice(0, 5)
    .map((pair) => {
      const timeLabel = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(pair.time));

      return {
        date: pair.date,
        time: iso(pair.time),
        bodies: [pair.first, pair.second],
        separation: round(pair.separation, 2),
        altitude: round(Math.min(pair.firstAltitude, pair.secondAltitude)),
        direction: pair.direction,
        evening:
          pair.evening === null
            ? null
            : {
                time: iso(pair.evening.time),
                separation: round(pair.evening.separation, 2),
                altitude: round(pair.evening.altitude),
                direction: pair.evening.direction,
              },
        note: `${pair.first} and ${pair.second} are ${round(pair.separation, 1)}° apart at ${timeLabel}.`,
      };
    });
}

function tleEpoch(line1) {
  const year = Number(line1.slice(18, 20));
  const day = Number(line1.slice(20, 32));
  const fullYear = year < 57 ? 2000 + year : 1900 + year;

  return new Date(Date.UTC(fullYear, 0, 1) + (day - 1) * DAY_MS);
}

async function fetchTleFromCelestrak(catnr) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${catnr}&FORMAT=TLE`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'cobb-bridge-club-night-hikes/1.0' },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`CelesTrak HTTP ${response.status}`);
  }

  const lines = (await response.text())
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3 || !/^1 /.test(lines[1]) || !/^2 /.test(lines[2])) {
    throw new Error('No TLE data returned');
  }

  return { name: lines[0], line1: lines[1], line2: lines[2] };
}

async function fetchTleFromMirror(catnr) {
  const response = await fetch(`https://tle.ivanstanojevic.me/api/tle/${catnr}`, {
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`TLE mirror HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!/^1 /.test(data.line1 || '') || !/^2 /.test(data.line2 || '')) {
    throw new Error('TLE mirror returned no usable data');
  }

  return { name: data.name, line1: data.line1, line2: data.line2 };
}

async function fetchTle(catnr) {
  try {
    return await fetchTleFromCelestrak(catnr);
  } catch (firstError) {
    try {
      return await fetchTleFromMirror(catnr);
    } catch (secondError) {
      throw new Error(`${firstError.message}; ${secondError.message}`);
    }
  }
}

function passesForSatellite(tle, observer, startMs, endMs, timezone) {
  const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
  const ground = {
    longitude: satellite.degreesToRadians(observer.longitude),
    latitude: satellite.degreesToRadians(observer.latitude),
    height: observer.height / 1000,
  };
  const passes = [];
  let current = null;

  for (let time = startMs; time < endMs; time += 60 * 1000) {
    const when = new Date(time);
    const position = satellite.propagate(satrec, when);

    if (!position.position) {
      continue;
    }

    const gmst = satellite.gstime(when);
    const look = satellite.ecfToLookAngles(ground, satellite.eciToEcf(position.position, gmst));
    const altitude = satellite.radiansToDegrees(look.elevation);

    if (altitude >= 10) {
      if (current === null) {
        current = { start: time, peak: time, maxAltitude: altitude, azimuth: look.azimuth };
      } else if (altitude > current.maxAltitude) {
        current.peak = time;
        current.maxAltitude = altitude;
        current.azimuth = look.azimuth;
      }
    } else if (current !== null) {
      current.end = time;

      if (bodyHorizon(Body.Sun, new Date(current.peak), observer).altitude < -6) {
        passes.push({
          start: iso(current.start),
          peak: iso(current.peak),
          end: iso(current.end),
          maxAltitude: round(current.maxAltitude),
          direction: compass(satellite.radiansToDegrees(current.azimuth)),
        });
      }

      current = null;
    }
  }

  return {
    name: tle.name,
    tleEpoch: iso(tleEpoch(tle.line1)),
    passes,
    localDates: passes.map((pass) => localDateString(new Date(pass.peak), timezone)),
  };
}

async function buildSatellites(observer, startMs, endMs, timezone, locationName) {
  const targets = [
    { label: 'ISS', catnr: 25544 },
    { label: 'Tiangong', catnr: 48274 },
    { label: 'Hubble', catnr: 20580 },
  ];
  const results = [];
  const byDate = {};

  for (const target of targets) {
    try {
      const tle = await fetchTle(target.catnr);
      const result = {
        label: target.label,
        ...passesForSatellite(tle, observer, startMs, endMs, timezone),
      };

      results.push({ ...result, passes: result.passes.slice(0, 12) });

      for (const pass of result.passes) {
        const date = localDateString(new Date(pass.peak), timezone);

        (byDate[date] ||= []).push({ ...pass, satellite: target.label });
      }
    } catch (error) {
      console.warn(`${target.label} orbit data unavailable: ${error.message}`);
      results.push({
        label: target.label,
        unavailable: true,
        note: 'no pass prediction available right now',
      });
    }
  }

  for (const passes of Object.values(byDate)) {
    passes.sort((left, right) => left.peak.localeCompare(right.peak));
  }

  return {
    targets: results,
    byDate,
    note: 'These pass times are predictions and can shift —',
    searchUrl: `https://heavens-above.com/AllSats.aspx?lat=${observer.latitude}&lng=${observer.longitude}&loc=${encodeURIComponent((locationName || 'Cobb').split(',')[0])}`,
  };
}

function buildZodiacalLight(day, observer) {
  const month = Number(day.date.slice(5, 7));
  const spring = month >= 3 && month <= 4;
  const autumn = month >= 9 && month <= 10;

  if (!spring && !autumn) {
    return {
      active: false,
      note: 'False dawn is best in spring evenings and autumn mornings. Outside those seasons it is usually lost in twilight.',
    };
  }

  const best = spring
    ? new Date(Date.parse(day.darkStart) + 30 * MINUTE_MS)
    : new Date(Date.parse(day.darkEnd) - 30 * MINUTE_MS);
  const moon = moonAltitude(best, observer);

  return {
    active: true,
    season: spring ? 'spring' : 'autumn',
    when: spring ? 'evening' : 'morning',
    best: iso(best),
    moonUp: moon > -0.25,
    note: spring
      ? 'Look west after dusk for a faint cone of light leaning along the ecliptic. It needs a dark sky and no moon.'
      : 'Look east before dawn for a faint cone of light along the ecliptic. It needs a dark sky and no moon.',
  };
}

async function fetchSeeingForecast(observer, timezone) {
  const params = new URLSearchParams({
    lon: String(observer.longitude),
    lat: String(observer.latitude),
    ac: '0',
    unit: 'metric',
    output: 'json',
    tzshift: '0',
  });
  const response = await fetch(`https://www.7timer.info/bin/astro.php?${params.toString()}`, {
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`7Timer HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!Array.isArray(data.dataseries) || !/^\d{10}$/.test(data.init || '')) {
    throw new Error('7Timer returned no forecast series');
  }

  const init = data.init;
  const initMs = Date.UTC(
    Number(init.slice(0, 4)),
    Number(init.slice(4, 6)) - 1,
    Number(init.slice(6, 8)),
    Number(init.slice(8, 10)),
  );
  const series = data.dataseries.map((entry) => {
    const time = new Date(initMs + entry.timepoint * HOUR_MS);

    return {
      time: iso(time),
      localDate: localDateString(time, timezone),
      localHour: Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: 'numeric',
          hourCycle: 'h23',
        }).format(time),
      ),
      seeing: entry.seeing,
      transparency: entry.transparency,
      cloudCover: entry.cloudcover,
    };
  });

  return {
    source: '7Timer',
    init: iso(new Date(initMs)),
    series,
  };
}

export async function buildSkyExtras({
  days,
  timezone,
  observer,
  fullMoons,
  eveningEnd,
  locationName,
}) {
  const dayRecords = [];
  let today = null;

  for (const date of days) {
    const record = buildDay(date, { timezone, observer, fullMoons, eveningEnd });

    if (record === null) {
      continue;
    }

    dayRecords.push(record);

    if (today === null) {
      today = record;
    }
  }

  if (today === null) {
    return null;
  }

  const startMs = Date.parse(`${days[0]}T00:00:00Z`);
  const endMs = Date.parse(`${days[days.length - 1]}T23:59:59Z`);
  const localStartMs = zonedTimeToUtc(days[0], 0, 0, timezone).getTime();
  const localEndMs = zonedTimeToUtc(addDays(days[days.length - 1], 1), 0, 0, timezone).getTime();
  const newMoons = newMoonsBetween(startMs, endMs).map((moon) => ({
    instant: iso(moon),
    localDate: localDateString(moon, timezone),
  }));
  const meteorShowers = buildMeteorShowers(startMs, endMs, timezone, observer);
  const conjunctions = buildConjunctions(days[0], days.length, timezone, observer);
  const satellites = await buildSatellites(
    observer,
    localStartMs,
    localEndMs,
    timezone,
    locationName,
  );

  let seeing = null;

  try {
    seeing = await fetchSeeingForecast(observer, timezone);
  } catch (error) {
    console.warn(`Sky-steadiness forecast unavailable: ${error.message}`);
  }

  return {
    days: dayRecords,
    newMoons,
    moonNames: fullMoons
      .filter((moon) => moon.getTime() >= startMs && moon.getTime() <= endMs)
      .map((moon) => ({
        instant: iso(moon),
        localDate: localDateString(moon, timezone),
        name: FULL_MOON_NAMES[Number(localDateString(moon, timezone).slice(5, 7)) - 1],
      })),
    meteorShowers,
    eclipses: {
      lunar: findLunarEclipse(startMs, timezone, observer),
      solar: findSolarEclipse(startMs, timezone, observer),
    },
    conjunctions,
    zodiacalLight: buildZodiacalLight(today, observer),
    satellites,
    seeing,
  };
}
