/* Client renderer for the pre-generated Cobb night-hike almanac. */
(() => {
  'use strict';

  const root = document.querySelector('[data-night-hikes]');

  if (!root) {
    return;
  }

  const source = root.getAttribute('data-src');
  const defaultTimeZone = 'America/Los_Angeles';

  function localDateString(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = {};

    for (const part of parts) {
      if (part.type !== 'literal') {
        values[part.type] = part.value;
      }
    }

    return `${values.year}-${values.month}-${values.day}`;
  }

  function formatDate(dateString, timeZone) {
    // Noon UTC keeps the calendar date intact when it is formatted in Cobb.
    const date = new Date(`${dateString}T12:00:00Z`);

    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }

  function formatShortDate(dateString, timeZone) {
    const date = new Date(`${dateString}T12:00:00Z`);

    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }

  function formatTime(iso, timeZone) {
    if (!iso) {
      return null;
    }

    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  }

  function formatDateTime(iso, timeZone) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(iso));
  }

  function pluralDays(value) {
    return `${value} day${value === 1 ? '' : 's'}`;
  }

  function fullMoonFact(event, timeZone) {
    const date = formatShortDate(event.fullMoon.localDate, timeZone);
    const days = event.fullMoon.daysFromFullMoon;

    if (days === 0) {
      return `This is the night of the full moon (${date}).`;
    }

    if (days < 0) {
      return `This night is ${pluralDays(Math.abs(days))} before the full moon (${date}).`;
    }

    return `This night is ${pluralDays(days)} after the full moon (${date}).`;
  }

  function titleFor(event) {
    const bigMoon = event.isBigMoon || (event.reasons || []).includes('big-moon');
    const moonrise = event.moonriseInWindow || (event.reasons || []).includes('moonrise');

    if (bigMoon && moonrise) {
      return 'Big moon plus a moonrise';
    }

    if (bigMoon) {
      return 'Big moon over Cobb Mountain';
    }

    return 'Moonrise after sunset';
  }

  function summaryFor(event, timeZone) {
    const percent = Math.round(event.moonIllumination * 100);
    const sunset = formatTime(event.sunset, timeZone);
    const moonrise = formatTime(event.moonrise, timeZone);
    const end = formatTime(event.windowEnd, timeZone);

    if (event.isBigMoon && event.moonriseInWindow) {
      return `A ${percent}% moon is already part of the show, and it clears the horizon at ${moonrise}. Sunset is at ${sunset}; the evening window runs until ${end}.`;
    }

    if (event.isBigMoon) {
      return `The moon is ${percent}% lit and already above the horizon at sunset (${sunset}). It stays up through the evening cutoff at ${end}.`;
    }

    return `The moon rises at ${moonrise}, after sunset (${sunset}) and before the ${end} cutoff. It is ${percent}% lit, so bring a headlamp.`;
  }

  function createBadge(text, modifier) {
    const badge = document.createElement('span');
    badge.className = `badge badge--${modifier}`;
    badge.textContent = text;

    return badge;
  }

  function createFact(text) {
    const item = document.createElement('li');
    item.textContent = text;

    return item;
  }

  function createStat(term, description) {
    const wrapper = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');

    dt.textContent = term;
    dd.textContent = description;
    wrapper.append(dt, dd);

    return wrapper;
  }

  function createCard(event, index, timeZone, today) {
    const article = document.createElement('article');
    article.className = 'night-hike';

    const titleId = `night-hike-${index + 1}-title`;
    article.setAttribute('aria-labelledby', titleId);

    const rank = document.createElement('p');
    rank.className = 'night-hike__rank';
    rank.setAttribute('aria-hidden', 'true');
    rank.textContent = String(index + 1).padStart(2, '0');

    const body = document.createElement('div');
    body.className = 'night-hike__body';

    const kicker = document.createElement('p');
    kicker.className = 'night-hike__kicker';
    const date = document.createElement('time');
    date.dateTime = event.date;
    date.textContent = formatDate(event.date, timeZone);
    kicker.append(date);

    if (event.date === today) {
      kicker.append(' ', createBadge('Tonight', 'tonight'));
    }

    const title = document.createElement('h3');
    title.id = titleId;
    title.textContent = titleFor(event);

    const badges = document.createElement('p');
    badges.className = 'night-hike__badges';

    if (event.isBigMoon) {
      badges.append(createBadge('Big moon', 'moon'));
    }

    if (event.moonriseInWindow) {
      badges.append(createBadge(`Moonrise ${formatTime(event.moonrise, timeZone)}`, 'rise'));
    }

    const summary = document.createElement('p');
    summary.className = 'night-hike__summary';
    summary.textContent = summaryFor(event, timeZone);

    const facts = document.createElement('ul');
    facts.className = 'night-hike__facts';

    if (event.isBigMoon && event.fullMoon) {
      facts.append(createFact(fullMoonFact(event, timeZone)));
    }

    if (event.moonVisibleFrom && event.moonVisibleUntil) {
      facts.append(
        createFact(
          `Above the horizon from ${formatTime(event.moonVisibleFrom, timeZone)} to ${formatTime(event.moonVisibleUntil, timeZone)}, peaking around ${Math.round(event.moonAltitudeMax)}°.`,
        ),
      );
    }

    const stats = document.createElement('dl');
    stats.className = 'night-hike__stats';
    stats.append(
      createStat('Sunset', formatTime(event.sunset, timeZone)),
      createStat('Moonrise', formatTime(event.moonrise, timeZone) || 'No rise today'),
      createStat('Moonlight', `${Math.round(event.moonIllumination * 100)}% lit`),
      createStat('Window ends', formatTime(event.windowEnd, timeZone)),
    );

    body.append(kicker, title, badges, summary, facts, stats);
    article.append(rank, body);

    return article;
  }

  function showError(title, message, details) {
    root.setAttribute('aria-busy', 'false');
    root.replaceChildren();

    const box = document.createElement('div');
    box.className = 'almanac-error';
    box.setAttribute('role', 'alert');

    const heading = document.createElement('h3');
    heading.textContent = title;
    const paragraph = document.createElement('p');
    paragraph.textContent = message;

    box.append(heading, paragraph);

    if (details) {
      const detail = document.createElement('p');
      detail.className = 'small';
      detail.textContent = details;
      box.append(detail);
    }

    root.append(box);
  }

  function render(data) {
    const timeZone = (data.location && data.location.timezone) || defaultTimeZone;
    const today = localDateString(new Date(), timeZone);
    const now = Date.now();
    const range = data.range || {};
    const events = Array.isArray(data.events) ? data.events : [];

    root.setAttribute('aria-busy', 'false');
    root.replaceChildren();

    if (
      typeof range.start !== 'string' ||
      typeof range.end !== 'string' ||
      today < range.start ||
      today > range.end
    ) {
      const covers =
        range.start && range.end
          ? `${formatShortDate(range.start, timeZone)} through ${formatShortDate(range.end, timeZone)}`
          : 'an unknown range of dates';
      const generated = data.generatedAt
        ? ` The last chart was generated ${formatDateTime(data.generatedAt, timeZone)}.`
        : '';

      showError(
        'This almanac has gone stale',
        `The chart covers ${covers}, but today in Cobb is ${formatDate(today, timeZone)}. The volunteer astronomer needs to refresh it.${generated}`,
        'Ask the webmaster to run “npm run generate:night-hikes” and redeploy the site.',
      );
      return;
    }

    if (events.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'night-hikes__empty';
      empty.textContent =
        'No night in the almanac qualifies right now. The moon is not taking questions.';
      root.append(empty);
      return;
    }

    const upcoming = events
      .filter((event) => event && typeof event.date === 'string')
      .filter((event) => event.date >= today)
      .filter((event) => Date.parse(event.windowEnd) > now)
      .sort((left, right) => left.date.localeCompare(right.date));

    const shown = upcoming.slice(0, 3);

    const status = document.createElement('p');
    status.className = 'night-hikes__status';

    if (shown.length === 0) {
      status.textContent =
        'The remaining nights in this almanac have already happened. A fresh one is on the way.';
    } else {
      status.textContent = 'Here are the next three good nights for a walk in the woods.';
    }

    root.append(status);

    if (shown.length > 0) {
      const list = document.createElement('div');
      list.className = 'night-hike-list';

      for (const [index, event] of shown.entries()) {
        list.append(createCard(event, index, timeZone, today));
      }

      root.append(list);
    }

    if (shown.length > 0 && upcoming.length < 3) {
      const note = document.createElement('p');
      note.className = 'night-hikes__more small';
      note.textContent = `Only ${upcoming.length} qualifying night${upcoming.length === 1 ? '' : 's'} left in the almanac.`;
      root.append(note);
    }
  }

  async function load() {
    if (!source) {
      showError(
        'The almanac has no source',
        'This page does not know where to find the pre-generated lunar chart.',
      );
      return;
    }

    try {
      const response = await fetch(source, {
        headers: { Accept: 'application/json' },
        cache: 'no-cache',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      render(data);
    } catch (error) {
      showError(
        'The almanac mule is late',
        'The page could not fetch the pre-generated lunar chart. The moon is fine; the web server may be napping.',
        `Try reloading. If it keeps happening, the webmaster can run “npm run generate:night-hikes” and redeploy. (${error.message})`,
      );
    }
  }

  load();
})();
