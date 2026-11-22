/*
 * Build-time weather for the almanac cards.
 *
 * The compact shaping lives in assets/js/night-hikes-weather.js so the page can
 * reuse it when it refreshes a stale chart. This file only does the Node-side
 * fetch and wraps the result with source metadata.
 */

import '../../assets/js/night-hikes-weather.js';
import { localDateString } from './time.mjs';

const core = globalThis.NightHikeWeather;
const TIMEOUT_MS = 15000;
const USER_AGENT = 'cobb-bridge-club-night-hikes/1.0';

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * @param {{ latitude: number, longitude: number }} location
 * @param {string} timezone
 * @returns {Promise<{ source: string, fetchedAt: string, forecastThrough: string, hours: object[] }>}
 */
export async function fetchWeatherForecast(location, timezone) {
  const data = await fetchJson(core.buildWeatherUrl(location));
  const hours = core.parseWeatherJson(data);

  if (hours === null) {
    throw new Error('Open-Meteo returned no hourly forecast');
  }

  return {
    source: 'Open-Meteo',
    fetchedAt: new Date().toISOString(),
    forecastThrough: localDateString(new Date(hours[hours.length - 1].ms), timezone),
    hours,
  };
}

/**
 * @param {{ latitude: number, longitude: number }} location
 * @param {string} timezone
 * @returns {Promise<{ source: string, fetchedAt: string, forecastThrough: string, hours: object[] }>}
 */
export async function fetchAirQualityForecast(location, timezone) {
  const data = await fetchJson(core.buildAirUrl(location));
  const hours = core.parseAirJson(data);

  if (hours === null) {
    throw new Error('Open-Meteo air quality returned no hourly forecast');
  }

  return {
    source: 'Open-Meteo Air Quality',
    fetchedAt: new Date().toISOString(),
    forecastThrough: localDateString(new Date(hours[hours.length - 1].ms), timezone),
    hours,
  };
}

export function eveningWeather(forecast, event, timezone) {
  return core.eveningWeather(forecast.hours, event, timezone);
}

export function airForEvening(forecast, event) {
  return core.airForEvening(forecast.hours, event);
}

export function skyQualityFor(series, event) {
  return core.skyQualityFor(series, event);
}
