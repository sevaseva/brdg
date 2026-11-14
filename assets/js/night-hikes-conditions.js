/*
 * Live conditions for the night-hike page.
 *
 * This is deliberately a browser-side fetch: the page is static, and weather
 * changes far faster than the almanac build. Open-Meteo and NOAA both
 * allow cross-origin reads and neither needs a key. If a request fails the
 * page says so instead of inventing a number.
 */
(() => {
  'use strict';

  const root = document.querySelector('[data-night-conditions]');

  if (!root) {
    return;
  }

  const latitude = root.getAttribute('data-lat') || '38.8252778';
  const longitude = root.getAttribute('data-lon') || '-122.7024722';
  const timeZone = root.getAttribute('data-tz') || 'America/Los_Angeles';

  function localDateString(date) {
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

  function formatTime(date) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
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

  function stat(list, term, value) {
    const wrapper = document.createElement('div');
    wrapper.append(el('dt', null, term), el('dd', null, value));
    list.append(wrapper);
  }

  function nearestIndex(times, target) {
    let best = 0;

    for (let index = 0; index < times.length; index += 1) {
      if (times[index] <= target) {
        best = index;
      } else {
        break;
      }
    }

    return best;
  }

  function capitalized(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function airLabel(value) {
    if (value <= 12) {
      return 'good';
    }

    if (value <= 35) {
      return 'moderate';
    }

    if (value <= 55) {
      return 'poor';
    }

    return 'very poor';
  }

  function kpLabel(value) {
    if (value >= 7) {
      return 'possible at Cobb if the northern horizon is dark and clear';
    }

    if (value >= 5) {
      return 'unlikely at Cobb, but worth a glance north';
    }

    return 'unlikely at Cobb';
  }

  async function getWeather() {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude,
      longitude,
      hourly: 'cloud_cover,temperature_2m,wind_speed_10m,precipitation_probability',
      forecast_days: '2',
      timezone: timeZone,
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }

  async function getAirQuality() {
    const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    url.search = new URLSearchParams({
      latitude,
      longitude,
      hourly: 'pm2_5',
      forecast_days: '2',
      timezone: timeZone,
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }

  async function getAurora() {
    const response = await fetch(
      'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json',
      { signal: AbortSignal.timeout(12000) },
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }

  function render(weather, air, aurora) {
    root.replaceChildren();
    root.append(el('h3', null, 'Live conditions'));

    const list = el('dl', 'sky-stats');
    const today = localDateString(new Date());
    const target = `${today}T21:00`;
    let updated = null;

    if (weather) {
      const index = nearestIndex(weather.hourly.time, target);
      updated = weather.hourly.time[index];
      stat(list, 'Cloud cover', `${weather.hourly.cloud_cover[index]}%`);
      stat(list, 'Temperature', `${Math.round(weather.hourly.temperature_2m[index])}°F`);
      stat(list, 'Wind', `${Math.round(weather.hourly.wind_speed_10m[index])} mph`);
      stat(list, 'Rain chance', `${weather.hourly.precipitation_probability[index]}%`);
    } else {
      stat(list, 'Weather', 'unavailable right now');
    }

    if (air) {
      const index = nearestIndex(air.hourly.time, target);
      const value = air.hourly.pm2_5[index];

      stat(
        list,
        'Smoke',
        Number.isFinite(value) ? capitalized(airLabel(value)) : 'unavailable right now',
      );
    } else {
      stat(list, 'Smoke', 'unavailable right now');
    }

    if (aurora) {
      const now = Date.now();
      const upcoming = aurora
        .filter((entry) => {
          const time = Date.parse(`${entry.time_tag}Z`);

          return time >= now - 60 * 60 * 1000 && time <= now + 12 * 60 * 60 * 1000;
        })
        .map((entry) => Number(entry.kp));
      const maxKp = upcoming.length > 0 ? Math.max(...upcoming) : null;

      stat(list, 'Aurora', maxKp === null ? 'no forecast available' : capitalized(kpLabel(maxKp)));
    } else {
      stat(list, 'Aurora', 'unavailable right now');
    }

    root.append(list);

    const credit = el(
      'p',
      'small',
      updated
        ? `Weather and air quality for ${updated.replace('T', ' ')} Cobb local. Sources: Open-Meteo and NOAA SWPC. These update when the page loads, so the numbers can differ from the almanac's sky.`
        : 'Live weather and the aurora forecast could not be fetched. Check your favorite forecast before heading out.',
    );
    root.append(credit);

    if (updated) {
      root.append(
        el(
          'p',
          'small',
          `Fetched ${formatTime(new Date())} Cobb local. Cloud cover is a forecast, not a promise.`,
        ),
      );
    }
  }

  async function load() {
    const results = await Promise.allSettled([getWeather(), getAirQuality(), getAurora()]);

    render(
      results[0].status === 'fulfilled' ? results[0].value : null,
      results[1].status === 'fulfilled' ? results[1].value : null,
      results[2].status === 'fulfilled' ? results[2].value : null,
    );
  }

  load();
})();
