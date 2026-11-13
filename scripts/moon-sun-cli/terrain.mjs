/*
 * Terrain helpers for the standalone rise/set calculator.
 *
 * This module is deliberately independent of the site's night-hike build
 * tooling. It samples the surrounding terrain from a public elevation model,
 * turns it into a horizon profile, and caches the profile on disk.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const EARTH_RADIUS_METERS = 6_371_000;
const REFRACTION_COEFFICIENT = 0.13;
const EYE_HEIGHT_METERS = 1.7;
const DISTANCES_KILOMETERS = [
  0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 8, 10, 13, 16, 20, 25,
];
const API_URL = 'https://api.opentopodata.org/v1/srtm30m';

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function round(value, places = 5) {
  return Number(value.toFixed(places));
}

/**
 * Parse a Google Maps style pair such as
 *   38°49'10.7"N 122°41'55.4"W
 * or decimal degrees such as
 *   38.81964, -122.69872
 */
export function parseCoordinates(text) {
  const dms = [
    ...text.matchAll(
      /(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″]\s*)?)?([NSEW])/gi,
    ),
  ];

  let latitude = null;
  let longitude = null;

  if (dms.length >= 2) {
    for (const match of dms) {
      const degrees = Number(match[1]);
      const minutes = Number(match[2] || 0);
      const seconds = Number(match[3] || 0);
      const hemisphere = match[4].toUpperCase();
      const value = degrees + minutes / 60 + seconds / 3600;

      if (hemisphere === 'N' || hemisphere === 'S') {
        latitude = hemisphere === 'S' ? -value : value;
      } else if (hemisphere === 'E' || hemisphere === 'W') {
        longitude = hemisphere === 'W' ? -value : value;
      }
    }
  } else {
    const decimal = text.match(/-?\d+(?:\.\d+)?/g);

    if (decimal && decimal.length === 2) {
      latitude = Number(decimal[0]);
      longitude = Number(decimal[1]);
    }
  }

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error(
      'Coordinates must be a latitude and longitude such as 38°49\'10.7"N 122°41\'55.4"W or 38.81964, -122.69872.',
    );
  }

  return { latitude, longitude };
}

function defaultCacheDirectory() {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');

  return path.join(base, 'moon-sun-cli');
}

function cachePath({ latitude, longitude, elevationMeters, azimuthStep, cacheDirectory }) {
  const elevationKey = elevationMeters === null ? 'dem' : `${round(elevationMeters, 1)}m`;

  return path.join(
    cacheDirectory,
    `${round(latitude, 4)}_${round(longitude, 4)}_${azimuthStep}deg_${elevationKey}.json`,
  );
}

async function fetchJson(url, attempts = 5) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'cobb-moon-sun-cli/1.0' },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;

      if (attempt < attempts - 1) {
        await sleep(2_000 * 2 ** attempt);
      }
    }
  }

  throw lastError;
}

async function fetchElevations(points, log) {
  const elevations = [];

  for (let index = 0; index < points.length; index += 100) {
    const chunk = points.slice(index, index + 100);
    const locations = chunk
      .map((point) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`)
      .join('|');

    if (log && index === 0) {
      log(`  terrain samples: ${points.length} (${Math.ceil(points.length / 100)} requests)`);
    }

    const data = await fetchJson(`${API_URL}?locations=${locations}`);

    if (data.status !== 'OK' || !Array.isArray(data.results)) {
      throw new Error(`Elevation service returned ${data.status || 'an invalid response'}.`);
    }

    for (const result of data.results) {
      elevations.push(Number.isFinite(result.elevation) ? result.elevation : 0);
    }

    if (index + 100 < points.length) {
      await sleep(1_200);
    }
  }

  return elevations;
}

async function groundElevation(latitude, longitude, log) {
  if (log) {
    log('  looking up the ground elevation at the viewpoint');
  }

  const [elevation] = await fetchElevations([{ latitude, longitude }], null);

  return elevation;
}

function offsetPoint(latitude, longitude, azimuthDegrees, distanceKilometers) {
  const azimuth = (azimuthDegrees * Math.PI) / 180;
  const latitudeRadians = (latitude * Math.PI) / 180;
  const latitudeOffset = (distanceKilometers * Math.cos(azimuth)) / 111.32;
  const longitudeOffset =
    (distanceKilometers * Math.sin(azimuth)) / (111.32 * Math.cos(latitudeRadians));

  return {
    latitude: latitude + latitudeOffset,
    longitude: longitude + longitudeOffset,
  };
}

function horizonAngle(elevation, observerElevation, distanceKilometers) {
  const distanceMeters = distanceKilometers * 1_000;
  const curvatureDrop =
    (distanceMeters ** 2 / (2 * EARTH_RADIUS_METERS)) * (1 - REFRACTION_COEFFICIENT);
  const height = elevation - observerElevation - EYE_HEIGHT_METERS - curvatureDrop;

  return (Math.atan2(height, distanceMeters) * 180) / Math.PI;
}

function profileIsUsable(profile, { latitude, longitude, azimuthStep, elevationMeters }) {
  return (
    profile &&
    profile.version === 1 &&
    profile.source === 'opentopodata/srtm30m' &&
    profile.azimuthStep === azimuthStep &&
    profile.eyeHeightMeters === EYE_HEIGHT_METERS &&
    JSON.stringify(profile.distancesKilometers) === JSON.stringify(DISTANCES_KILOMETERS) &&
    Math.abs(profile.latitude - latitude) < 0.0001 &&
    Math.abs(profile.longitude - longitude) < 0.0001 &&
    (elevationMeters === null || Math.abs(profile.elevationMeters - elevationMeters) < 0.5)
  );
}

/**
 * Build (or load) a full-circle terrain horizon profile for a location.
 * Elevation angles are geometric degrees measured from the observer's eye.
 */
export async function buildHorizonProfile({
  latitude,
  longitude,
  elevationMeters = null,
  azimuthStep = 2,
  cacheDirectory = defaultCacheDirectory(),
  refresh = false,
  log = null,
}) {
  const file = cachePath({
    latitude,
    longitude,
    elevationMeters,
    azimuthStep,
    cacheDirectory,
  });

  if (!refresh) {
    try {
      const cached = JSON.parse(await fs.readFile(file, 'utf8'));

      if (profileIsUsable(cached, { latitude, longitude, azimuthStep, elevationMeters })) {
        if (log) {
          log(`  using cached terrain profile: ${file}`);
        }

        return cached;
      }
    } catch {
      // No usable cache; build a fresh profile.
    }
  }

  const ground =
    elevationMeters === null ? await groundElevation(latitude, longitude, log) : elevationMeters;

  if (log) {
    log(`  building terrain profile at ${ground.toFixed(0)} m, ${azimuthStep}° steps`);
  }

  const azimuths = [];
  const points = [];

  for (let azimuth = 0; azimuth < 360; azimuth += azimuthStep) {
    azimuths.push(azimuth);

    for (const distance of DISTANCES_KILOMETERS) {
      const point = offsetPoint(latitude, longitude, azimuth, distance);

      points.push({ ...point, azimuth, distance });
    }
  }

  const elevations = await fetchElevations(points, log);
  const horizon = new Array(azimuths.length).fill(-90);

  for (let index = 0; index < points.length; index += 1) {
    const azimuthIndex = Math.floor(index / DISTANCES_KILOMETERS.length);
    const angle = horizonAngle(elevations[index], ground, points[index].distance);

    if (angle > horizon[azimuthIndex]) {
      horizon[azimuthIndex] = angle;
    }
  }

  const profile = {
    version: 1,
    source: 'opentopodata/srtm30m',
    latitude,
    longitude,
    elevationMeters: ground,
    eyeHeightMeters: EYE_HEIGHT_METERS,
    azimuthStep,
    distancesKilometers: DISTANCES_KILOMETERS,
    azimuths,
    elevations: horizon.map((value) => round(value, 2)),
    generatedAt: new Date().toISOString(),
  };

  await fs.mkdir(cacheDirectory, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');

  if (log) {
    log(`  cached terrain profile: ${file}`);
  }

  return profile;
}

/**
 * Interpolate the geometric terrain horizon at an azimuth, in degrees.
 */
export function horizonElevation(profile, azimuth) {
  const step = profile.azimuthStep;
  const normalized = ((azimuth % 360) + 360) % 360;
  const lower = Math.floor(normalized / step);
  const upper = (lower + 1) % profile.azimuths.length;
  const ratio = (normalized - lower * step) / step;

  return profile.elevations[lower] * (1 - ratio) + profile.elevations[upper] * ratio;
}

export { EYE_HEIGHT_METERS };
