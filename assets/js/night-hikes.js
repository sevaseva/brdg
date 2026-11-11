/* Client renderer for the pre-generated Cobb night-hike almanac. */
(() => {
  'use strict';

  const root = document.querySelector('[data-night-hikes]');

  if (!root) {
    return;
  }

  const source = root.getAttribute('data-src');
  const defaultTimeZone = 'America/Los_Angeles';
  const defaultWindowDays = 14;

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

  function addDaysToDateString(dateString, days) {
    const date = new Date(`${dateString}T12:00:00Z`);

    date.setUTCDate(date.getUTCDate() + days);

    return date.toISOString().slice(0, 10);
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

  function formatMonthDay(dateString, timeZone) {
    const date = new Date(`${dateString}T12:00:00Z`);

    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  // Almanacs round to the nearest minute; Intl drops seconds. Nudge forward
  // half a minute before formatting so a 16:53:30 sunset reads as 4:54 PM.
  const HALF_MINUTE_MS = 30 * 1000;

  function roundToMinute(date) {
    return new Date(date.getTime() + HALF_MINUTE_MS);
  }

  function formatTime(iso, timeZone) {
    if (!iso) {
      return null;
    }

    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(roundToMinute(new Date(iso)));
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
    }).format(roundToMinute(new Date(iso)));
  }

  function badgeForReason(reason, event, timeZone) {
    const modifiers = {
      'big-moon': 'moon',
      moonrise: 'rise',
      'milky-way': 'star',
      'meteor-shower': 'meteor',
      'satellite-pass': 'satellite',
      conjunction: 'event',
      'lunar-eclipse': 'eclipse',
      'solar-eclipse': 'eclipse',
    };

    if (reason.id === 'moonrise') {
      return { text: `Moonrise ${formatTime(event.moonrise, timeZone)}`, modifier: 'rise' };
    }

    return {
      text: reason.label,
      modifier: modifiers[reason.id] || 'moon',
    };
  }

  function createBadge(text, modifier) {
    const badge = document.createElement('span');
    badge.className = `badge badge--${modifier}`;
    badge.textContent = text;

    return badge;
  }

  function createFact(text, recheckUrl) {
    const item = document.createElement('li');
    item.append(document.createTextNode(text));

    if (recheckUrl) {
      item.append(document.createTextNode(' Pass times can shift; '));
      item.append(createExternalLink('recheck', recheckUrl));
      item.append(document.createTextNode(' before you go.'));
    }

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

  function el(tag, className, text) {
    const node = document.createElement(tag);

    if (className) {
      node.className = className;
    }

    if (text !== undefined) {
      node.textContent = text;
    }

    return node;
  }

  function appendStat(list, term, value) {
    list.append(createStat(term, value));
  }

  function appendStrongLine(parent, strongText, rest) {
    const item = document.createElement('li');
    item.append(el('strong', null, strongText), document.createTextNode(rest));
    parent.append(item);
  }

  function createExternalLink(label, url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'external-link';
    link.textContent = label;

    return link;
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

  function ratingLabel(value) {
    if (!Number.isFinite(value)) {
      return 'unknown';
    }

    if (value <= 2) {
      return 'excellent';
    }

    if (value <= 4) {
      return 'good';
    }

    if (value <= 6) {
      return 'fair';
    }

    return 'poor';
  }

  function targetType(type) {
    return type === 'planetary nebula' ? 'nebula' : type;
  }

  function renderTonight(container, day, sky, timeZone) {
    container.replaceChildren();
    container.append(el('h3', null, 'Tonight in Cobb'));

    if (!day) {
      container.append(
        el(
          'p',
          'small',
          'The sky summary is not available for tonight. The moon is still up there.',
        ),
      );
      return;
    }

    container.append(el('p', 'small', `${formatDate(day.date, timeZone)} · all times Cobb local`));

    const stats = el('dl', 'sky-stats');
    appendStat(stats, 'Sunset', formatTime(day.sunset, timeZone));
    if (day.sunsetRidge) {
      appendStat(stats, 'Behind the ridge', formatTime(day.sunsetRidge, timeZone));
    }
    appendStat(
      stats,
      'Dark sky',
      `${formatTime(day.darkStart, timeZone)} – ${formatTime(day.darkEnd, timeZone)}`,
    );
    appendStat(
      stats,
      'Moon-free',
      day.moonFreeStart
        ? `${formatTime(day.moonFreeStart, timeZone)} – ${formatTime(day.moonFreeEnd, timeZone)}`
        : 'No moon-free window',
    );
    if (day.milkyWay && day.milkyWay.evening && day.milkyWay.evening.visible) {
      appendStat(
        stats,
        'Milky Way core',
        `Up from ${formatTime(day.milkyWay.evening.from, timeZone)}`,
      );
    }
    appendStat(
      stats,
      'Moon',
      `${day.moon.phase} · ${Math.round(day.moon.illumination * 100)}% lit`,
    );
    if (sky.moonNames && sky.moonNames.length > 0) {
      appendStat(
        stats,
        'Next full moon',
        `${sky.moonNames[0].name} · ${formatMonthDay(sky.moonNames[0].localDate, timeZone)}`,
      );
    }
    appendStat(stats, 'Sunrise', formatTime(day.sunrise, timeZone) || '—');
    appendStat(
      stats,
      'Blue hour',
      day.blueHour && day.blueHour.start
        ? `${formatTime(day.blueHour.start, timeZone)} – ${formatTime(day.blueHour.end, timeZone)}`
        : '—',
    );
    appendStat(
      stats,
      'Golden hour',
      day.goldenHour && day.goldenHour.start
        ? `${formatTime(day.goldenHour.start, timeZone)} – ${formatTime(day.goldenHour.end, timeZone)}`
        : '—',
    );
    container.append(stats);

    container.append(el('h4', null, 'Planets up'));

    if (!day.planets || day.planets.length === 0) {
      container.append(el('p', 'small', 'No bright planet is easy to see at 9 PM tonight.'));
    } else {
      const list = el('ul', 'sky-list');
      for (const planet of day.planets) {
        appendStrongLine(
          list,
          planet.name,
          ` — ${Math.round(planet.altitude)}° above the ${directionName(planet.direction)} horizon${
            planet.phase < 0.99 ? ` · ${Math.round(planet.phase * 100)}% lit` : ''
          }`,
        );
      }
      container.append(list);
    }
  }

  function renderTargets(container, day, sky, timeZone) {
    container.replaceChildren();
    container.append(el('h3', null, 'Things to point at'));

    if (day && day.constellation) {
      container.append(el('h4', null, `Constellation: ${day.constellation.name}`));
      container.append(el('p', null, day.constellation.story));
      container.append(
        el('p', 'small', `${Math.round(day.constellation.altitude)}° above the horizon at 9 PM.`),
      );
    }

    if (day && day.deepSky && day.deepSky.length > 0) {
      container.append(el('h4', null, 'Binocular targets'));
      const list = el('ul', 'sky-list');
      for (const target of day.deepSky) {
        appendStrongLine(
          list,
          `${target.catalog} ${target.name}`,
          ` — ${Math.round(target.altitude)}° above the horizon · ${targetType(target.type)}`,
        );
      }
      container.append(list);
      container.append(el('p', 'small', day.deepSky[0].note));
    }

    if (sky.zodiacalLight) {
      container.append(el('h4', null, 'False dawn'));
      const paragraph = el('p', null, sky.zodiacalLight.note);

      if (sky.zodiacalLight.active && sky.zodiacalLight.best) {
        paragraph.append(
          document.createTextNode(
            ` Try around ${formatTime(sky.zodiacalLight.best, timeZone)}; ${
              sky.zodiacalLight.moonUp
                ? 'the moon may wash it out.'
                : 'the moon should be out of the way.'
            }`,
          ),
        );
      }

      container.append(paragraph);
    }
  }

  function renderAhead(container, sky, timeZone) {
    container.replaceChildren();
    container.append(el('h3', null, 'Coming up'));

    if (sky.meteorShowers && sky.meteorShowers.length > 0) {
      container.append(el('h4', null, 'Meteor showers'));

      for (const shower of sky.meteorShowers) {
        const block = el('div', 'sky-event');
        block.append(
          el(
            'p',
            'sky-event__title',
            `${shower.name} — ${formatShortDate(shower.localDate, timeZone)} · ${shower.verdict}`,
          ),
        );
        block.append(el('p', 'small', shower.note));
        container.append(block);
      }
    }

    container.append(el('h4', null, 'Eclipses'));
    container.append(el('p', 'small', 'The next ones visible from Cobb, however far off:'));

    if (sky.eclipses && sky.eclipses.lunar) {
      container.append(
        el(
          'p',
          null,
          `Lunar: ${sky.eclipses.lunar.kind} on ${formatDateTime(sky.eclipses.lunar.peak, timeZone)} · Moon ${Math.round(sky.eclipses.lunar.altitude)}° above the horizon.`,
        ),
      );
    } else {
      container.append(
        el('p', 'small', 'No lunar eclipse visible from Cobb in the next few years.'),
      );
    }

    if (sky.eclipses && sky.eclipses.solar) {
      container.append(
        el(
          'p',
          null,
          `Solar: ${sky.eclipses.solar.kind} on ${formatDateTime(sky.eclipses.solar.peak, timeZone)} · Sun ${Math.round(sky.eclipses.solar.altitude)}° above the horizon.`,
        ),
      );
    } else {
      container.append(
        el('p', 'small', 'No solar eclipse visible from Cobb in the next few years.'),
      );
    }

    if (sky.conjunctions && sky.conjunctions.length > 0) {
      container.append(el('h4', null, 'Close planet pairs'));
      for (const pair of sky.conjunctions) {
        const view = pair.evening || {
          time: pair.time,
          separation: pair.separation,
          altitude: pair.altitude,
          direction: pair.direction,
        };
        container.append(
          el(
            'p',
            null,
            `${pair.bodies.join(' + ')} — ${formatShortDate(pair.date, timeZone)}, ${view.separation}° apart at ${formatTime(view.time, timeZone)}, ${Math.round(view.altitude)}° above the ${directionName(view.direction)} horizon.`,
          ),
        );
      }
    }

    if (sky.newMoons && sky.newMoons.length > 0) {
      container.append(el('h4', null, 'Dark-of-moon dates'));
      const list = el('ul', 'sky-list');
      for (const moon of sky.newMoons) {
        list.append(el('li', null, formatShortDate(moon.localDate, timeZone)));
      }
      container.append(list);
    }

    if (sky.moonNames && sky.moonNames.length > 0) {
      container.append(el('h4', null, 'Full moon names'));
      const list = el('ul', 'sky-list');
      for (const moon of sky.moonNames) {
        list.append(el('li', null, `${moon.name} — ${formatShortDate(moon.localDate, timeZone)}`));
      }
      container.append(list);
    }
  }

  function renderCuriosities(container, sky, timeZone) {
    container.replaceChildren();
    container.append(el('h3', null, 'Satellites & curiosities'));

    if (sky.satellites && sky.satellites.targets) {
      container.append(el('h4', null, 'ISS and friends'));

      for (const target of sky.satellites.targets) {
        if (target.unavailable) {
          container.append(el('p', 'small', `${target.label}: unavailable (${target.note}).`));
          continue;
        }

        const now = Date.now();
        const passes = (target.passes || [])
          .filter((pass) => Date.parse(pass.peak) > now)
          .slice(0, 3);

        if (passes.length === 0) {
          container.append(
            el('p', 'small', `${target.label}: no bright passes left in this chart.`),
          );
          continue;
        }

        for (const pass of passes) {
          container.append(
            el(
              'p',
              null,
              `${target.label} — ${formatDateTime(pass.peak, timeZone)} · ${pass.maxAltitude}° above the ${directionName(pass.direction)} horizon.`,
            ),
          );
        }
      }

      const note = el('p', 'small', `${sky.satellites.note} `);

      if (sky.satellites.searchUrl) {
        note.append(
          createExternalLink('recheck', sky.satellites.searchUrl),
          document.createTextNode(' before you head out.'),
        );
      }

      container.append(note);
    }

    container.append(el('h4', null, 'Sky steadiness and clarity'));

    if (sky.seeing && Array.isArray(sky.seeing.series)) {
      const today = localDateString(new Date(), timeZone);
      const options = sky.seeing.series.filter((entry) => entry.localDate === today);
      const entry = options.sort(
        (left, right) => Math.abs(left.localHour - 21) - Math.abs(right.localHour - 21),
      )[0];

      if (entry) {
        container.append(
          el(
            'p',
            null,
            `Steady air: ${ratingLabel(entry.seeing)} · Clarity: ${ratingLabel(entry.transparency)}.`,
          ),
        );
        container.append(
          el(
            'p',
            'small',
            `Forecast for tonight (${formatDate(entry.localDate, timeZone)}) at ${formatTime(entry.time, timeZone)}.`,
          ),
        );
      } else {
        container.append(el('p', 'small', 'No sky-steadiness forecast for tonight.'));
      }
    } else {
      container.append(el('p', 'small', 'No sky-steadiness forecast is available right now.'));
    }
  }

  function renderSky(data, timeZone, today) {
    const sky = data.sky;

    if (!sky) {
      return;
    }

    const days = Array.isArray(sky.days) ? sky.days : [];
    const day = days.find((entry) => entry.date === today) || days[0];
    const tonight = document.querySelector('[data-night-tonight]');
    const targets = document.querySelector('[data-night-targets]');
    const ahead = document.querySelector('[data-night-ahead]');
    const curiosities = document.querySelector('[data-night-curiosities]');

    if (tonight) {
      renderTonight(tonight, day, sky, timeZone);
    }

    if (targets) {
      renderTargets(targets, day, sky, timeZone);
    }

    if (ahead) {
      renderAhead(ahead, sky, timeZone);
    }

    if (curiosities) {
      renderCuriosities(curiosities, sky, timeZone);
    }
  }

  function createCard(event, index, timeZone, today) {
    const article = document.createElement('article');
    article.className = 'night-hike';

    const titleId = `night-hike-${index + 1}-title`;
    article.setAttribute('aria-labelledby', titleId);

    const rank = document.createElement('p');
    rank.className = 'night-hike__rank';
    rank.setAttribute('aria-hidden', 'true');
    rank.textContent = formatMonthDay(event.date, timeZone);

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

    const reasons = Array.isArray(event.reasons) ? event.reasons : [];
    const primary = reasons[0];

    const title = document.createElement('h3');
    title.id = titleId;
    title.textContent = primary ? primary.title : 'A good night for a walk';

    const badges = document.createElement('p');
    badges.className = 'night-hike__badges';

    for (const reason of reasons) {
      const badge = badgeForReason(reason, event, timeZone);
      badges.append(createBadge(badge.text, badge.modifier));
    }

    const summary = document.createElement('p');
    summary.className = 'night-hike__summary';
    summary.textContent = primary ? primary.summary : 'Something in the sky is worth the walk.';

    if (primary && primary.recheckUrl) {
      summary.append(document.createTextNode(' Pass times can shift; '));
      summary.append(createExternalLink('recheck', primary.recheckUrl));
      summary.append(document.createTextNode(' before you go.'));
    }

    const facts = document.createElement('ul');
    facts.className = 'night-hike__facts';

    const reasonIds = new Set(reasons.map((reason) => reason.id));

    for (const [reasonIndex, reason] of reasons.entries()) {
      if (reasonIndex > 0) {
        facts.append(createFact(reason.summary, reason.recheckUrl));
      }

      for (const fact of reason.facts || []) {
        facts.append(createFact(fact));
      }
    }

    for (const feature of event.features || []) {
      if (!reasonIds.has(feature.id)) {
        facts.append(createFact(feature.summary, feature.recheckUrl));
      }
    }

    const stats = document.createElement('dl');
    stats.className = 'night-hike__stats';
    const statItems = [createStat('Sunset', formatTime(event.sunset, timeZone))];

    if (event.sunsetRidge) {
      statItems.push(createStat('Behind the ridge', formatTime(event.sunsetRidge, timeZone)));
    }

    statItems.push(
      createStat('Moonrise', formatTime(event.moonrise, timeZone) || 'No rise today'),
      createStat('Moonlight', `${Math.round(event.moonIllumination * 100)}% lit`),
    );
    stats.append(...statItems);

    body.append(kicker, title, badges, summary);

    if (facts.childElementCount > 0) {
      body.append(facts);
    }

    body.append(stats);
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
    const display = data.display || {};
    const windowDays =
      Number.isInteger(display.windowDays) && display.windowDays > 0
        ? display.windowDays
        : defaultWindowDays;
    const windowText =
      windowDays === 14
        ? 'next two weeks'
        : windowDays === 7
          ? 'next week'
          : `next ${windowDays} days`;
    const windowEndDate = addDaysToDateString(today, windowDays - 1);
    const windowLabel = document.querySelector('[data-night-hike-window]');

    if (windowLabel) {
      windowLabel.textContent = windowText;
    }

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

    renderSky(data, timeZone, today);

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
      .filter((event) => event.date >= today && event.date <= windowEndDate)
      .filter((event) => Date.parse(event.windowEnd) > now)
      .sort((left, right) => left.date.localeCompare(right.date));

    const shown = upcoming;

    const status = document.createElement('p');
    status.className = 'night-hikes__status';

    if (shown.length === 0) {
      status.textContent = `No good nights in the ${windowText}.`;
    } else if (shown.length === 1) {
      status.textContent = `Here is the good night in the ${windowText}.`;
    } else {
      status.textContent = `Here are all the good nights in the ${windowText}.`;
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
