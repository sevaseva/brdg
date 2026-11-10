/*
 * Small timezone and calendar helpers for the night-hike generator.
 *
 * The generator must behave the same on a laptop in Cobb and on a GitHub
 * Actions runner in UTC, so every date is treated as a Cobb local date and
 * converted to a precise UTC instant here.
 */

function partsFor(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = {};

  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  return parts;
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = partsFor(date, timeZone);
  let hour = Number(parts.hour);

  // Some engines report midnight as 24 instead of 00.
  if (hour === 24) {
    hour = 0;
  }

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );

  // Ignore sub-second differences; they only add noise to the offset.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Return the calendar date in a timezone as YYYY-MM-DD.
 *
 * @param {Date} date
 * @param {string} timeZone
 * @returns {string}
 */
export function localDateString(date, timeZone) {
  const parts = partsFor(date, timeZone);

  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Convert a wall-clock date and time in a timezone to a UTC Date.
 *
 * @param {string} dateString YYYY-MM-DD
 * @param {number} hour 0-23
 * @param {number} minute 0-59
 * @param {string} timeZone
 * @returns {Date}
 */
export function zonedTimeToUtc(dateString, hour, minute, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);

  if (!match) {
    throw new Error(`Invalid date "${dateString}"; expected YYYY-MM-DD.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = timeZoneOffsetMs(new Date(guess), timeZone);
  let timestamp = guess - firstOffset;
  const secondOffset = timeZoneOffsetMs(new Date(timestamp), timeZone);

  if (secondOffset !== firstOffset) {
    timestamp = guess - secondOffset;
  }

  return new Date(timestamp);
}

/**
 * Add a whole number of days to a YYYY-MM-DD string.
 *
 * @param {string} dateString
 * @param {number} days
 * @returns {string}
 */
export function addDays(dateString, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);

  if (!match) {
    throw new Error(`Invalid date "${dateString}"; expected YYYY-MM-DD.`);
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));

  return date.toISOString().slice(0, 10);
}

/**
 * Difference in calendar days between two YYYY-MM-DD strings.
 *
 * @param {string} later
 * @param {string} earlier
 * @returns {number}
 */
export function dayDifference(later, earlier) {
  const laterMs = Date.parse(`${later}T00:00:00Z`);
  const earlierMs = Date.parse(`${earlier}T00:00:00Z`);

  return Math.round((laterMs - earlierMs) / (24 * 60 * 60 * 1000));
}

/**
 * Parse a 24-hour clock string such as "22:00".
 *
 * @param {string} value
 * @returns {{ hour: number, minute: number }}
 */
export function parseClock(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);

  if (!match) {
    throw new Error(`Invalid clock value "${value}"; expected HH:MM (24-hour).`);
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}
