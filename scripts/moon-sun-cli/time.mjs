/*
 * Small timezone helpers for the standalone rise/set calculator.
 *
 * These are intentionally separate from the website's build-tooling helpers so
 * the CLI can keep working if the site generator changes.
 */

function partsFor(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values = {};

  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }

  return values;
}

export function localDateString(date, timeZone) {
  const parts = partsFor(date, timeZone);

  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function offsetMilliseconds(date, timeZone) {
  const parts = partsFor(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - date.getTime();
}

/**
 * Convert a local wall-clock time in an IANA timezone to a UTC Date.
 */
export function zonedTimeToUtc(dateString, hour, minute, timeZone) {
  const [year, month, day] = dateString.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    guess = target - offsetMilliseconds(new Date(guess), timeZone);
  }

  return new Date(guess);
}

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}
