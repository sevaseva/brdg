/*
 * Shared weather helpers for the night-hike page.
 *
 * Loaded as a plain script by the browser and imported for its side effect by
 * the build-time generator, which reads globalThis.NightHikeWeather. Keep this
 * file free of DOM and Node APIs: it only turns Open-Meteo hourly data and the
 * 7Timer series into the compact, color-coded values the cards show.
 */
(function (root) {
  'use strict';

  const MINUTE_MS = 60 * 1000;
  const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
  const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

  function finite(value) {
    return Number.isFinite(value);
  }

  function round(value, places = 0) {
    const factor = 10 ** places;

    return Math.round(value * factor) / factor;
  }

  function formatHour(iso, timeZone) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
    }).format(new Date(iso));
  }

  function nearest(samples, targetMs) {
    let best = null;

    for (const sample of samples) {
      if (best === null || Math.abs(sample.ms - targetMs) < Math.abs(best.ms - targetMs)) {
        best = sample;
      }
    }

    return best;
  }

  function sampleAt(hours, iso) {
    const target = Date.parse(iso);

    if (!finite(target)) {
      return null;
    }

    const sample = nearest(hours, target);

    if (sample === null || Math.abs(sample.ms - target) > 90 * MINUTE_MS) {
      return null;
    }

    return sample;
  }

  /* Color rules: green is good for a night out, yellow is fair, red is poor. */
  function toneForTemperature(value) {
    if (!finite(value)) {
      return null;
    }

    if (value >= 40 && value <= 75) {
      return 'good';
    }

    if (value >= 30 && value <= 80) {
      return 'fair';
    }

    return 'bad';
  }

  function toneForCloud(value) {
    if (!finite(value)) {
      return null;
    }

    if (value <= 25) {
      return 'good';
    }

    if (value <= 70) {
      return 'fair';
    }

    return 'bad';
  }

  function toneForWind(wind, gust) {
    const sustained = finite(wind) ? wind : 0;
    const gusting = finite(gust) ? gust : sustained;

    if (sustained > 20 || gusting > 30) {
      return 'bad';
    }

    if (sustained >= 10 || gusting >= 15) {
      return 'fair';
    }

    return 'good';
  }

  function toneForPrecipitation(type, snowCm, chance) {
    if (type === 'rain' || type === 'mixed' || type === 'storm') {
      return 'bad';
    }

    if (type === 'snow') {
      if (snowCm <= 1) {
        return 'good';
      }

      if (snowCm <= 3) {
        return 'fair';
      }

      return 'bad';
    }

    return chance >= 30 ? 'fair' : 'good';
  }

  function toneForVisibility(km) {
    if (!finite(km)) {
      return null;
    }

    if (km >= 10) {
      return 'good';
    }

    if (km >= 2) {
      return 'fair';
    }

    return 'bad';
  }

  function toneForIndex(value) {
    if (!finite(value)) {
      return null;
    }

    if (value <= 3) {
      return 'good';
    }

    if (value <= 6) {
      return 'fair';
    }

    return 'bad';
  }

  function toneForSmoke(value) {
    if (!finite(value)) {
      return null;
    }

    if (value <= 12) {
      return 'good';
    }

    if (value <= 35) {
      return 'fair';
    }

    return 'bad';
  }

  function temperatureCell(sample) {
    if (!sample || !finite(sample.temperature_2m)) {
      return null;
    }

    const value = Math.round(sample.temperature_2m);

    return { text: `${value}°F`, tone: toneForTemperature(value) };
  }

  function cloudCell(sample) {
    if (!sample || !finite(sample.cloud_cover)) {
      return null;
    }

    const value = Math.round(sample.cloud_cover);

    return { text: `${value}%`, tone: toneForCloud(value) };
  }

  function windCell(sample) {
    if (!sample) {
      return null;
    }

    const wind = finite(sample.wind_speed_10m) ? Math.round(sample.wind_speed_10m) : null;
    const gust = finite(sample.wind_gusts_10m) ? Math.round(sample.wind_gusts_10m) : null;
    const parts = [];

    if (wind !== null) {
      parts.push(`${wind} mph`);
    }

    if (gust !== null && (wind === null || gust > wind)) {
      parts.push(`gusts ${gust}`);
    }

    if (parts.length === 0) {
      return null;
    }

    return { text: parts.join(' · '), tone: toneForWind(wind, gust) };
  }

  function precipitationCell(sample) {
    if (!sample) {
      return null;
    }

    const chance = finite(sample.precipitation_probability)
      ? Math.round(sample.precipitation_probability)
      : 0;
    const total = finite(sample.precipitation) ? round(sample.precipitation, 1) : 0;
    const snow = finite(sample.snowfall) ? round(sample.snowfall, 1) : 0;
    const code = sample.weather_code;
    const isStorm = finite(code) && code >= 95;
    const isSnow = snow >= 0.05 || (finite(code) && SNOW_CODES.has(code));
    const isRain = total > 0 || (finite(code) && RAIN_CODES.has(code));
    const totalInches = total > 0 ? round(total / 25.4, 2) : 0;
    const snowInches = snow > 0 ? round(snow / 2.54, 2) : 0;
    const totalText = total > 0 ? `${totalInches === 0 ? '<0.01' : totalInches} in/h` : '0 in/h';
    const snowText = snow > 0 ? `${snowInches === 0 ? '<0.01' : snowInches} in/h` : '0 in/h';
    let type = 'none';
    let amount = '0 in/h';

    if (isStorm) {
      type = 'storm';
      amount = total > 0 ? `storms ${totalText}` : '0 in/h';
    } else if (isSnow && isRain) {
      type = 'mixed';
      amount = total > 0 ? `rain/snow ${totalText}` : '0 in/h';
    } else if (isSnow) {
      type = 'snow';
      amount = snow > 0 ? `snow ${snowText}` : '0 in/h';
    } else if (isRain) {
      type = 'rain';
      amount = total > 0 ? `rain ${totalText}` : '0 in/h';
    }

    return {
      text: `${chance}% · ${amount}`,
      tone: toneForPrecipitation(type, snow, chance),
    };
  }

  function visibilityCell(sample) {
    if (!sample || !finite(sample.visibility)) {
      return null;
    }

    const km = sample.visibility / 1000;
    const miles = round(km / 1.609344, 1);

    return { text: `${miles} mi`, tone: toneForVisibility(km) };
  }

  function weatherAt(sample, label) {
    if (!sample) {
      return null;
    }

    const cells = {
      label,
      temperature: temperatureCell(sample),
      cloud: cloudCell(sample),
      wind: windCell(sample),
      precipitation: precipitationCell(sample),
      visibility: visibilityCell(sample),
    };
    const hasCell = ['temperature', 'cloud', 'wind', 'precipitation', 'visibility'].some(
      (key) => cells[key] !== null,
    );

    return hasCell ? cells : null;
  }

  function eveningWeather(hours, day, timeZone) {
    if (!Array.isArray(hours) || !day) {
      return null;
    }

    const sunset = weatherAt(sampleAt(hours, day.sunset), 'Sunset');
    const ten = weatherAt(sampleAt(hours, day.windowEnd), formatHour(day.windowEnd, timeZone));

    if (sunset === null && ten === null) {
      return null;
    }

    return { sunset, ten };
  }

  function indexCell(value) {
    if (!finite(value)) {
      return null;
    }

    return { text: `${value}/8`, tone: toneForIndex(value) };
  }

  function seriesAt(series, iso, localDate) {
    const target = Date.parse(iso);

    if (!finite(target)) {
      return null;
    }

    let best = null;

    for (const entry of series) {
      if (entry.localDate !== localDate) {
        continue;
      }

      const time = Date.parse(entry.time);

      if (!finite(time)) {
        continue;
      }

      const distance = Math.abs(time - target);

      if (best === null || distance < best.distance) {
        best = { entry, distance };
      }
    }

    // The 7Timer series is three-hourly, so allow up to two hours.
    if (best === null || best.distance > 2 * 60 * MINUTE_MS) {
      return null;
    }

    return best.entry;
  }

  function skyQualityFor(series, event) {
    if (!Array.isArray(series) || !event) {
      return null;
    }

    const sunset = seriesAt(series, event.sunset, event.date);
    const ten = seriesAt(series, event.windowEnd, event.date);

    if (sunset === null && ten === null) {
      return null;
    }

    return {
      sunset:
        sunset === null
          ? null
          : {
              steadiness: indexCell(sunset.seeing),
              clarity: indexCell(sunset.transparency),
            },
      ten:
        ten === null
          ? null
          : {
              steadiness: indexCell(ten.seeing),
              clarity: indexCell(ten.transparency),
            },
    };
  }

  function smokeLabel(value) {
    if (value <= 12) {
      return 'Low';
    }

    if (value <= 35) {
      return 'Moderate';
    }

    if (value <= 55) {
      return 'High';
    }

    return 'Very high';
  }

  function smokeCell(sample) {
    if (!sample || !finite(sample.pm2_5)) {
      return null;
    }

    const value = round(sample.pm2_5, 1);

    return { text: smokeLabel(value), tone: toneForSmoke(value) };
  }

  function airForEvening(hours, day) {
    if (!Array.isArray(hours) || !day) {
      return null;
    }

    const sunset = smokeCell(sampleAt(hours, day.sunset));
    const ten = smokeCell(sampleAt(hours, day.windowEnd));

    if (sunset === null && ten === null) {
      return null;
    }

    return { sunset, ten };
  }

  function buildWeatherUrl(location) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');

    url.search = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      hourly: [
        'cloud_cover',
        'temperature_2m',
        'precipitation_probability',
        'precipitation',
        'rain',
        'showers',
        'snowfall',
        'weather_code',
        'wind_speed_10m',
        'wind_gusts_10m',
        'visibility',
      ].join(','),
      forecast_days: '16',
      timezone: 'GMT',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
    }).toString();

    return url.toString();
  }

  function parseWeatherJson(data) {
    const hourly = data && data.hourly;

    if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) {
      return null;
    }

    return hourly.time.map((time, index) => {
      const sample = { ms: Date.parse(time.length === 16 ? `${time}:00Z` : `${time}Z`) };

      for (const key of Object.keys(hourly)) {
        if (key !== 'time') {
          sample[key] = hourly[key][index];
        }
      }

      return sample;
    });
  }

  function buildAirUrl(location) {
    const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');

    url.search = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      hourly: 'pm2_5',
      forecast_days: '7',
      timezone: 'GMT',
    }).toString();

    return url.toString();
  }

  function parseAirJson(data) {
    const hourly = data && data.hourly;

    if (!hourly || !Array.isArray(hourly.time)) {
      return null;
    }

    return hourly.time.map((time, index) => ({
      ms: Date.parse(time.length === 16 ? `${time}:00Z` : `${time}Z`),
      pm2_5: hourly.pm2_5 ? hourly.pm2_5[index] : null,
    }));
  }

  root.NightHikeWeather = {
    airForEvening,
    buildAirUrl,
    buildWeatherUrl,
    eveningWeather,
    parseAirJson,
    parseWeatherJson,
    skyQualityFor,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
