/*
 * Terrain-aware rise and set calculations for the standalone calculator.
 *
 * The flat-horizon rise/set is used as a search anchor. The actual event is
 * the moment the upper limb of the Sun or Moon crosses the local terrain
 * horizon. Trees and buildings are not part of the elevation model.
 */

import { AstroTime, Body, Equator, Horizon, SearchRiseSet } from 'astronomy-engine';

import { horizonElevation } from './terrain.mjs';
import { localDateString, zonedTimeToUtc } from './time.mjs';

const SUN_RADIUS_DEGREES = 0.266;
const MOON_RADIUS_DEGREES = 0.259;
const SEARCH_WINDOW_MS = 4 * 60 * 60 * 1000;
const SAMPLE_STEP_MS = 2 * 60 * 1000;

function refractionDegrees(altitude) {
  const height = Math.max(altitude, -1);

  return 1.02 / Math.tan(((height + 10.3 / (height + 5.11)) * Math.PI) / 180) / 60;
}

function ridgeApparent(profile, azimuth) {
  const geometric = horizonElevation(profile, azimuth);

  return geometric + refractionDegrees(geometric);
}

function bodyUpper(body, date, observer, radius) {
  const equator = Equator(body, new AstroTime(date), observer, true, true);
  const horizontal = Horizon(new AstroTime(date), observer, equator.ra, equator.dec, 'normal');

  return {
    altitude: horizontal.altitude + radius,
    azimuth: horizontal.azimuth,
  };
}

/**
 * Standard rise/set for the given observer, ignoring terrain and using the
 * observer's elevation. Pass a sea-level Observer for official sea-level times.
 */
export function officialRiseSet({ body, date, timeZone, observer, direction }) {
  const midnight = zonedTimeToUtc(date, 0, 0, timeZone);
  const event = SearchRiseSet(body, observer, direction, midnight, 1.2);

  if (event === null || localDateString(event.date, timeZone) !== date) {
    return null;
  }

  return event.date;
}

/**
 * Find when the upper limb crosses the local terrain horizon.
 *
 * direction: +1 for rise, -1 for set.
 * Returns a Date, or null when there is no crossing that day.
 */
export function terrainRiseSet({ body, radius, date, timeZone, observer, profile, direction }) {
  const anchor = officialRiseSet({ body, date, timeZone, observer, direction });

  if (anchor === null) {
    return null;
  }

  const start = anchor.getTime() - SEARCH_WINDOW_MS;
  const end = anchor.getTime() + SEARCH_WINDOW_MS;
  const difference = (time) => {
    const sun = bodyUpper(body, new Date(time), observer, radius);

    return sun.altitude - ridgeApparent(profile, sun.azimuth);
  };
  let previous = difference(start);
  let firstRise = null;
  let lastSet = null;

  for (let time = start + SAMPLE_STEP_MS; time <= end; time += SAMPLE_STEP_MS) {
    const current = difference(time);

    if (previous <= 0 && current > 0 && firstRise === null) {
      firstRise = { low: time - SAMPLE_STEP_MS, high: time };
    }

    if (previous >= 0 && current < 0) {
      lastSet = { low: time - SAMPLE_STEP_MS, high: time };
    }

    previous = current;
  }

  const crossing = direction > 0 ? firstRise : lastSet;

  if (crossing === null) {
    return null;
  }

  let low = crossing.low;
  let high = crossing.high;
  const positiveAtLow = difference(low) > 0;

  for (let iteration = 0; iteration < 30; iteration += 1) {
    const middle = (low + high) / 2;
    const positive = difference(middle) > 0;

    if (positive === positiveAtLow) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return new Date((low + high) / 2);
}

export { Body, MOON_RADIUS_DEGREES, SUN_RADIUS_DEGREES };
