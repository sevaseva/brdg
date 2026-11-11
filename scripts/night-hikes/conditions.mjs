/*
 * What makes a night "good", and what is merely interesting.
 *
 * A night joins the almanac when at least one condition in CONDITIONS matches.
 * Each condition returns a short, page-ready explanation. Features are the
 * things worth mentioning in a night's details even when they are not the
 * reason it qualified (a bright Milky Way on a big-moon night, a moon-washed
 * meteor shower, a modest satellite pass, and so on).
 *
 * Adding a condition means adding one entry to CONDITIONS. Adding a feature
 * means adding one block to buildFeatures. Nothing else in the generator needs
 * to know about either.
 */

import { dayDifference } from './time.mjs';

/* Thresholds for the conditions. Tweak these rather than the evaluation code. */
const METEOR_SHOWER_PEAK_DAYS = 1;
const METEOR_SHOWER_MIN_RADIANT_DEGREES = 20;
const METEOR_SHOWER_MAX_MOON_ILLUMINATION = 0.5;
const MILKY_WAY_MIN_WINDOW_MINUTES = 20;
const SATELLITE_TARGETS = ['ISS', 'Tiangong'];
const SATELLITE_MIN_ALTITUDE_DEGREES = 45;
const SATELLITE_REASON_DAYS = 14;
const CONJUNCTION_MAX_SEPARATION_DEGREES = 3;

/* The first reason on a night is the headline; higher wins. */
const PRIORITY = {
  'solar-eclipse': 100,
  'lunar-eclipse': 95,
  'meteor-shower': 90,
  moonrise: 85,
  'big-moon': 80,
  'milky-way': 70,
  conjunction: 60,
  'satellite-pass': 50,
};

const HALF_MINUTE_MS = 30 * 1000;

function rounded(date) {
  return new Date(date.getTime() + HALF_MINUTE_MS);
}

function formatTime(instant, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(rounded(new Date(instant)));
}

function formatDay(localDate, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${localDate}T12:00:00Z`));
}

function percent(value) {
  return Math.round(value * 100);
}

const COMPASS = {
  N: 'northern',
  NE: 'north-eastern',
  E: 'eastern',
  SE: 'south-eastern',
  S: 'southern',
  SW: 'south-western',
  W: 'western',
  NW: 'north-western',
};

function directionName(direction) {
  return COMPASS[direction] || direction;
}

function recheckUrl(satellite, location) {
  const catalog = { ISS: 25544, Tiangong: 48274, Hubble: 20580 };
  const params = new URLSearchParams({
    satid: String(catalog[satellite] || 25544),
    lat: String(location.latitude),
    lng: String(location.longitude),
    loc: location.name ? location.name.split(',')[0] : 'Cobb',
  });

  return `https://heavens-above.com/PassSummary.aspx?${params.toString()}`;
}

function inEvening(pass, day) {
  return (
    Date.parse(pass.peak) >= Date.parse(day.sunset) &&
    Date.parse(pass.peak) <= Date.parse(day.windowEnd)
  );
}

function passesOnDate(sky, date) {
  return sky.satellites && sky.satellites.byDate && sky.satellites.byDate[date]
    ? sky.satellites.byDate[date]
    : [];
}

function showersNear(sky, date) {
  return (sky.meteorShowers || []).filter(
    (shower) => Math.abs(dayDifference(shower.localDate, date)) <= METEOR_SHOWER_PEAK_DAYS,
  );
}

function isMoonOK(shower) {
  return shower.moonAltitude < 0 || shower.moonIllumination <= METEOR_SHOWER_MAX_MOON_ILLUMINATION;
}

const CONDITIONS = [
  {
    id: 'solar-eclipse',
    label: 'Solar eclipse',
    evaluate({ date, sky, timezone }) {
      const eclipse = sky.eclipses && sky.eclipses.solar;

      if (!eclipse || eclipse.localDate !== date) {
        return null;
      }

      return {
        title: 'Solar eclipse',
        summary: `The ${eclipse.kind} solar eclipse peaks at ${formatTime(eclipse.peak, timezone)}; the Sun is ${eclipse.altitude}° above the horizon and ${percent(eclipse.obscuration)}% covered.`,
        facts: [
          'This one happens in daylight, so the club counts it as an event worth planning around rather than a night hike.',
        ],
      };
    },
  },
  {
    id: 'lunar-eclipse',
    label: 'Lunar eclipse',
    evaluate({ date, sky, timezone }) {
      const eclipse = sky.eclipses && sky.eclipses.lunar;

      if (!eclipse || eclipse.localDate !== date) {
        return null;
      }

      return {
        title: 'Lunar eclipse',
        summary: `The ${eclipse.kind} lunar eclipse peaks at ${formatTime(eclipse.peak, timezone)}, with the Moon ${eclipse.altitude}° above the horizon.`,
        facts: [`About ${percent(eclipse.obscuration)}% of the Moon is in Earth's shadow at peak.`],
      };
    },
  },
  {
    id: 'meteor-shower',
    label: 'Meteor shower',
    evaluate({ date, sky, timezone }) {
      const candidates = showersNear(sky, date).filter(
        (shower) => shower.radiantAltitude >= METEOR_SHOWER_MIN_RADIANT_DEGREES && isMoonOK(shower),
      );

      if (candidates.length === 0) {
        return null;
      }

      const shower = candidates.sort((left, right) => right.zhr - left.zhr)[0];
      const difference = dayDifference(shower.localDate, date);
      const when =
        difference === 0
          ? 'Peaks tonight.'
          : difference > 0
            ? 'Peaks tomorrow night.'
            : 'Peaked last night and is still active.';

      return {
        title: `${shower.name} meteor shower`,
        summary: `${when} ${shower.note}`,
        facts: [],
      };
    },
  },
  {
    id: 'milky-way',
    label: 'Milky Way',
    evaluate({ skyDay, timezone }) {
      const evening = skyDay && skyDay.milkyWay && skyDay.milkyWay.evening;

      if (!evening || !evening.visible) {
        return null;
      }

      const minutes = (Date.parse(evening.to) - Date.parse(evening.from)) / 60000;

      if (minutes < MILKY_WAY_MIN_WINDOW_MINUTES) {
        return null;
      }

      return {
        title: 'Bright Milky Way core',
        summary: `The bright core is ${evening.altitude}° above the horizon around ${formatTime(evening.best, timezone)}, with the moon down.`,
        facts: [
          `The core is up from ${formatTime(evening.from, timezone)}.`,
          'The core is the Sagittarius end: star clouds, dark rifts, and the brightest part of the Milky Way.',
        ],
      };
    },
  },
  {
    id: 'satellite-pass',
    label: 'Satellite pass',
    evaluate({ date, day, sky, timezone, config }) {
      const buildDate = sky.days && sky.days[0] ? sky.days[0].date : null;

      if (buildDate) {
        const daysFromBuild = dayDifference(date, buildDate);

        if (daysFromBuild < 0 || daysFromBuild > SATELLITE_REASON_DAYS) {
          return null;
        }
      }

      const candidates = passesOnDate(sky, date)
        .filter(
          (pass) =>
            SATELLITE_TARGETS.includes(pass.satellite) &&
            pass.maxAltitude >= SATELLITE_MIN_ALTITUDE_DEGREES &&
            inEvening(pass, day),
        )
        .sort((left, right) => right.maxAltitude - left.maxAltitude);

      if (candidates.length === 0) {
        return null;
      }

      const pass = candidates[0];
      const others = candidates
        .slice(1, 3)
        .map(
          (other) =>
            `${other.satellite} also passes at ${formatTime(other.peak, timezone)}, ${other.maxAltitude}° above the horizon.`,
        );

      return {
        title: `Bright ${pass.satellite} pass`,
        summary: `${pass.satellite} climbs to ${pass.maxAltitude}° above the ${directionName(pass.direction)} horizon at ${formatTime(pass.peak, timezone)}.`,
        facts: others,
        recheckUrl: recheckUrl(pass.satellite, config.location),
      };
    },
  },
  {
    id: 'conjunction',
    label: 'Planet pair',
    evaluate({ date, sky, timezone }) {
      const pair = (sky.conjunctions || []).find(
        (candidate) =>
          candidate.date === date &&
          candidate.evening &&
          candidate.evening.separation <= CONJUNCTION_MAX_SEPARATION_DEGREES,
      );

      if (!pair) {
        return null;
      }

      return {
        title: `${pair.bodies[0]} and ${pair.bodies[1]} side by side`,
        summary: `${pair.bodies[0]} and ${pair.bodies[1]} are ${pair.evening.separation}° apart at ${formatTime(pair.evening.time, timezone)}, ${Math.round(pair.evening.altitude)}° above the ${directionName(pair.evening.direction)} horizon.`,
        facts: ['A close pair is easy to see with the unaided eye, and lovely in binoculars.'],
      };
    },
  },
  {
    id: 'big-moon',
    label: 'Big moon',
    evaluate({ day, timezone }) {
      if (!day.isBigMoon || !day.moonVisible) {
        return null;
      }

      const lit = percent(day.moonIllumination);
      const summary = day.moonriseInWindow
        ? `A ${lit}% moon is up for the evening.`
        : `The moon is ${lit}% lit and already above the horizon at sunset (${formatTime(day.sunset, timezone)}).`;
      const facts = [];

      if (day.fullMoon) {
        const difference = day.fullMoon.daysFromFullMoon;
        const date = formatDay(day.fullMoon.localDate, timezone);

        facts.push(
          difference === 0
            ? `This is the night of the full moon (${date}).`
            : `This night is ${Math.abs(difference)} day${Math.abs(difference) === 1 ? '' : 's'} ${difference < 0 ? 'before' : 'after'} the full moon (${date}).`,
        );
      }

      facts.push(
        `Visible from ${formatTime(day.moonVisibleFrom, timezone)}, reaching about ${day.moonAltitudeMax}° above the horizon.`,
      );

      return { title: 'Big moon over Cobb Mountain', summary, facts };
    },
  },
  {
    id: 'moonrise',
    label: 'Moonrise',
    evaluate({ day, timezone }) {
      const lit = day.moonIlluminationAtMoonrise ?? day.moonIllumination;

      if (!day.moonriseInWindow || lit <= 0.5) {
        return null;
      }

      return {
        title: 'Moonrise in the evening',
        summary: `A ${percent(lit)}% moon clears the horizon at ${formatTime(day.moonrise, timezone)}, after sunset.`,
        facts: [`Sunset is at ${formatTime(day.sunset, timezone)}.`],
      };
    },
  },
];

export function buildReasons(context) {
  return CONDITIONS.map((condition) => {
    const match = condition.evaluate(context);

    if (!match) {
      return null;
    }

    return {
      id: condition.id,
      label: condition.label,
      priority: PRIORITY[condition.id] || 0,
      ...match,
    };
  })
    .filter(Boolean)
    .sort((left, right) => right.priority - left.priority);
}

/*
 * Features are deliberately local to a night: they are the things the card
 * should mention even when the night made the list for another reason.
 */
export function buildFeatures(context) {
  const { date, skyDay, sky, timezone, config } = context;
  const features = [];

  if (skyDay) {
    const evening = skyDay.milkyWay && skyDay.milkyWay.evening;

    if (evening && evening.visible) {
      features.push({
        id: 'milky-way',
        label: 'Milky Way',
        summary: `The bright Milky Way core is ${evening.altitude}° above the horizon around ${formatTime(evening.best, timezone)}, with the moon down.`,
      });
    }

    if (skyDay.planets && skyDay.planets.length > 0) {
      const names = skyDay.planets.slice(0, 3).map((planet) => planet.name);

      features.push({
        id: 'planets',
        label: 'Planets',
        summary: `Also up: ${names.join(', ')}.`,
      });
    }
  }

  for (const shower of showersNear(sky, date)) {
    if (shower.radiantAltitude < METEOR_SHOWER_MIN_RADIANT_DEGREES) {
      continue;
    }

    features.push({
      id: 'meteor-shower',
      label: 'Meteor shower',
      summary: `${shower.name}: ${shower.note}`,
    });
    break;
  }

  const buildDate = sky.days && sky.days[0] ? sky.days[0].date : null;
  const daysFromBuild = buildDate ? dayDifference(date, buildDate) : 0;
  const passes =
    daysFromBuild <= SATELLITE_REASON_DAYS
      ? passesOnDate(sky, date)
          .filter((pass) => inEvening(pass, context.day))
          .sort((left, right) => right.maxAltitude - left.maxAltitude)
      : [];

  if (passes.length > 0) {
    const first = passes[0];

    features.push({
      id: 'satellite-pass',
      label: 'Satellite',
      summary: `${first.satellite} passes at ${formatTime(first.peak, timezone)}, ${first.maxAltitude}° above the ${directionName(first.direction)} horizon.`,
      recheckUrl: recheckUrl(first.satellite, config.location),
    });
  }

  const pair = (sky.conjunctions || []).find((candidate) => candidate.date === date);

  if (pair) {
    const view = pair.evening || pair;
    const where = view.direction
      ? `above the ${directionName(view.direction)} horizon`
      : 'above the horizon';

    features.push({
      id: 'conjunction',
      label: 'Planet pair',
      summary: `${pair.bodies[0]} and ${pair.bodies[1]} are ${view.separation}° apart at ${formatTime(view.time, timezone)}, ${Math.round(view.altitude)}° ${where}.`,
    });
  }

  return features;
}

export const CONDITION_IDS = CONDITIONS.map((condition) => condition.id);
