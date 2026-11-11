/*
 * A thin wrapper around Astronomy Engine for the night-hike almanac.
 *
 * Astronomy Engine is MIT-licensed and provides accurate topocentric moon
 * positions, rise/set times, phase, and illumination. We keep the library
 * calls here so the generator file stays about the club's rules rather than
 * about ephemerides.
 */

import {
  AstroTime,
  Body,
  Equator,
  Horizon,
  Illumination,
  Observer,
  SearchMoonPhase,
  SearchRiseSet,
} from 'astronomy-engine';

import { localDateString, zonedTimeToUtc } from './time.mjs';

export function createObserver(location) {
  return new Observer(location.latitude, location.longitude, location.elevationMeters);
}

/**
 * Standard sunset on a Cobb local date, or null if the date has no sunset.
 */
export function sunsetOn(date, timeZone, observer) {
  const midnight = zonedTimeToUtc(date, 0, 0, timeZone);
  const event = SearchRiseSet(Body.Sun, observer, -1, midnight, 1.2);

  if (event === null || localDateString(event.date, timeZone) !== date) {
    return null;
  }

  return event.date;
}

/**
 * Standard moonrise (top of the moon at the horizon) on a Cobb local date.
 */
export function moonriseOn(date, timeZone, observer) {
  const midnight = zonedTimeToUtc(date, 0, 0, timeZone);
  const event = SearchRiseSet(Body.Moon, observer, +1, midnight, 1.2);

  if (event === null || localDateString(event.date, timeZone) !== date) {
    return null;
  }

  return event.date;
}

/**
 * Standard moonset (top of the moon at the horizon) on a Cobb local date.
 */
export function moonsetOn(date, timeZone, observer) {
  const midnight = zonedTimeToUtc(date, 0, 0, timeZone);
  const event = SearchRiseSet(Body.Moon, observer, -1, midnight, 1.2);

  if (event === null || localDateString(event.date, timeZone) !== date) {
    return null;
  }

  return event.date;
}

/**
 * Standard sunrise (top of the sun at the horizon) on a Cobb local date.
 */
export function sunriseOn(date, timeZone, observer) {
  const midnight = zonedTimeToUtc(date, 0, 0, timeZone);
  const event = SearchRiseSet(Body.Sun, observer, +1, midnight, 1.2);

  if (event === null || localDateString(event.date, timeZone) !== date) {
    return null;
  }

  return event.date;
}

/**
 * Apparent topocentric altitude of the moon's center, in degrees, including
 * standard atmospheric refraction.
 */
export function moonAltitude(date, observer) {
  const time = new AstroTime(date);
  const equator = Equator(Body.Moon, time, observer, true, true);
  const horizon = Horizon(time, observer, equator.ra, equator.dec, 'normal');

  return horizon.altitude;
}

/**
 * Illuminated fraction of the moon, from 0 to 1.
 */
export function moonIllumination(date) {
  return Illumination(Body.Moon, date).phase_fraction;
}

/**
 * All full-moon instants between two timestamps.
 *
 * @param {number} startMs
 * @param {number} endMs
 * @returns {Date[]}
 */
export function fullMoonsBetween(startMs, endMs) {
  const fullMoons = [];
  let cursor = new AstroTime(new Date(startMs));

  while (cursor.date.getTime() < endMs) {
    // The next full moon is never more than about 30 days away.
    const fullMoon = SearchMoonPhase(180, cursor, 40);

    if (fullMoon === null || fullMoon.date.getTime() > endMs) {
      break;
    }

    fullMoons.push(fullMoon.date);
    cursor = new AstroTime(new Date(fullMoon.date.getTime() + 24 * 60 * 60 * 1000));
  }

  return fullMoons;
}
