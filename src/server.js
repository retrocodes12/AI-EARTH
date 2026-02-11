import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import { fileURLToPath } from 'node:url';
import jstatPkg from 'jstat';
import ee from '@google/earthengine';
import getTrainedClassifier from './classifier.js';
import getKeralaRegion from './keralaRegion.js';
import getKeralaDistricts from './districtRegion.js';
import {
  getLandChangeMap,
  getLandYearMap,
  getNdviTimeSeries,
  getRainfallTrendTimeSeries,
  getTemperatureTrendTimeSeries,
  getUrbanChangeTimeSeries,
  initializeEarthEngine
} from './gee.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const currentModulePath = fileURLToPath(import.meta.url);
const entryScriptPath = process.argv[1] || '';
const isDirectRun = currentModulePath === entryScriptPath;
const classificationCache = {};
const statsCache = {};
const statsPromiseCache = {};
const responseCache = {};
const inFlightResponseCache = {};
let earthEngineInitPromise = null;
const { jStat } = jstatPkg;
const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const localOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/;
const vercelAiEarthOriginPattern = /^https:\/\/ai-earth(?:-[a-z0-9-]+)?\.vercel\.app$/;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (configuredOrigins.length > 0 && configuredOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      if (vercelAiEarthOriginPattern.test(origin)) {
        callback(null, true);
        return;
      }

      if (configuredOrigins.length === 0 && localOriginPattern.test(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    }
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

app.use(async (req, res, next) => {
  try {
    if (req.path === '/health') {
      next();
      return;
    }

    await ensureEarthEngineInitialized();
    next();
  } catch (error) {
    console.error('Failed to initialize Google Earth Engine:', error);
    res.status(500).json({
      error: {
        message: 'Earth Engine initialization failed. Check backend environment variables.',
        details: error?.message || 'Unknown error'
      }
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

function isValidDateInput(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime());
}

function maskSentinelClouds(image) {
  const qa60 = image.select('QA60');
  const cloudBitMask = 1 << 10;
  const cirrusBitMask = 1 << 11;
  const cloudMask = qa60
    .bitwiseAnd(cloudBitMask)
    .eq(0)
    .and(qa60.bitwiseAnd(cirrusBitMask).eq(0));

  return image.updateMask(cloudMask);
}

function makeCacheKey(prefix, params) {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}:${String(params[key])}`)
    .join('|');
  return `${prefix}|${sorted}`;
}

async function getOrSetResponseCache(cacheKey, computeFn) {
  if (Object.hasOwn(responseCache, cacheKey)) {
    return responseCache[cacheKey];
  }

  if (inFlightResponseCache[cacheKey]) {
    return inFlightResponseCache[cacheKey];
  }

  inFlightResponseCache[cacheKey] = Promise.resolve()
    .then(computeFn)
    .then((value) => {
      responseCache[cacheKey] = value;
      delete inFlightResponseCache[cacheKey];
      return value;
    })
    .catch((error) => {
      delete inFlightResponseCache[cacheKey];
      throw error;
    });

  return inFlightResponseCache[cacheKey];
}

function generateLandCover(year) {
  const yearKey = String(year);
  if (classificationCache[yearKey]) {
    return classificationCache[yearKey];
  }
  const keralaRegion = getKeralaRegion();
  const trainedClassifier = getTrainedClassifier();

  const start = ee.Date.fromYMD(Number(year), 1, 1);
  const end = start.advance(1, 'year');

  const sentinelComposite = ee
    .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate(start, end)
    .filterBounds(keralaRegion)
    .map(maskSentinelClouds)
    .median()
    .select(['B2', 'B3', 'B4', 'B8', 'B11']);

  const ndvi = sentinelComposite.normalizedDifference(['B8', 'B4']).rename('NDVI');
  const ndwi = sentinelComposite.normalizedDifference(['B3', 'B8']).rename('NDWI');
  const ndbi = sentinelComposite.normalizedDifference(['B11', 'B8']).rename('NDBI');

  const predictorImage = sentinelComposite
    .addBands([ndvi, ndwi, ndbi])
    .resample('bilinear')
    .reproject({
      crs: 'EPSG:4326',
      scale: 30
    });
  const classified = predictorImage.classify(trainedClassifier).clip(keralaRegion);

  classificationCache[yearKey] = classified;
  return classified;
}

function getTileUrlForImage(image, visParams) {
  return new Promise((resolve, reject) => {
    image.getMapId(visParams, (mapId, error) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (!mapId) {
        reject(new Error('Failed to generate map ID.'));
        return;
      }

      resolve(mapId.urlFormat || mapId.formatTileUrl('{x}', '{y}', '{z}'));
    });
  });
}

function evaluateEeObject(eeObject) {
  return new Promise((resolve, reject) => {
    eeObject.evaluate((result, error) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve(result);
    });
  });
}

async function getLandCoverStats(year) {
  const yearKey = String(year);
  if (statsCache[yearKey]) {
    return statsCache[yearKey];
  }
  if (statsPromiseCache[yearKey]) {
    return statsPromiseCache[yearKey];
  }

  statsPromiseCache[yearKey] = (async () => {
    const keralaRegion = getKeralaRegion();
    const classified = generateLandCover(year).rename('class');
    const areaByClass = ee
      .Image.pixelArea()
      .divide(1e6)
      .rename('area')
      .addBands(classified)
      .reduceRegion({
        reducer: ee.Reducer.sum().group({
          groupField: 1,
          groupName: 'class'
        }),
        geometry: keralaRegion,
        scale: 30,
        maxPixels: 1e13,
        tileScale: 4,
        bestEffort: true
      });

    const computed = await evaluateEeObject(areaByClass);
    const groups = Array.isArray(computed?.groups) ? computed.groups : [];

    const stats = {
      water: 0,
      forest: 0,
      agriculture: 0,
      urban: 0,
      bare: 0
    };

    for (const entry of groups) {
      const classId = Number(entry?.class);
      const areaKm2 = Number(entry?.sum);
      if (!Number.isFinite(classId) || !Number.isFinite(areaKm2)) {
        continue;
      }

      if (classId === 0) stats.water = areaKm2;
      if (classId === 1) stats.forest = areaKm2;
      if (classId === 2) stats.agriculture = areaKm2;
      if (classId === 3) stats.urban = areaKm2;
      if (classId === 4) stats.bare = areaKm2;
    }

    statsCache[yearKey] = stats;
    return stats;
  })();

  try {
    return await statsPromiseCache[yearKey];
  } finally {
    delete statsPromiseCache[yearKey];
  }
}

async function getDistrictLandCoverStats(year, districtName) {
  const districtKey = String(districtName).trim();
  if (!districtKey) {
    throw new Error('Invalid district name.');
  }

  const cacheKey = makeCacheKey('district-stats', { year, district: districtKey });
  return getOrSetResponseCache(cacheKey, async () => {
    const districts = getKeralaDistricts();
    const districtGeometry = districts
      .filter(ee.Filter.eq('ADM2_NAME', districtKey))
      .geometry();
    const classified = generateLandCover(year).rename('class');

    const areaByClass = ee
      .Image.pixelArea()
      .divide(1e6)
      .rename('area')
      .addBands(classified)
      .reduceRegion({
        reducer: ee.Reducer.sum().group({
          groupField: 1,
          groupName: 'class'
        }),
        geometry: districtGeometry,
        scale: 30,
        maxPixels: 1e13,
        tileScale: 4,
        bestEffort: true
      });

    const computed = await evaluateEeObject(areaByClass);
    const groups = Array.isArray(computed?.groups) ? computed.groups : [];

    const stats = {
      water: 0,
      forest: 0,
      agriculture: 0,
      urban: 0,
      bare: 0
    };

    for (const entry of groups) {
      const classId = Number(entry?.class);
      const areaKm2 = Number(entry?.sum);
      if (!Number.isFinite(classId) || !Number.isFinite(areaKm2)) {
        continue;
      }

      if (classId === 0) stats.water = areaKm2;
      if (classId === 1) stats.forest = areaKm2;
      if (classId === 2) stats.agriculture = areaKm2;
      if (classId === 3) stats.urban = areaKm2;
      if (classId === 4) stats.bare = areaKm2;
    }

    return stats;
  });
}

function parseChangeYears(beforeYear, afterYear) {
  const before = Number(beforeYear);
  const after = Number(afterYear);

  if (!Number.isInteger(before) || !Number.isInteger(after)) {
    const error = new Error('Invalid years. Expected integer beforeYear and afterYear.');
    error.statusCode = 400;
    throw error;
  }

  if (before < 2015 || after < 2015) {
    const error = new Error('Invalid years. Use beforeYear and afterYear >= 2015.');
    error.statusCode = 400;
    throw error;
  }

  if (after <= before) {
    const error = new Error('afterYear must be greater than beforeYear.');
    error.statusCode = 400;
    throw error;
  }

  return { before, after };
}

function getTransitionMaskedImage(before, after) {
  const beforeKey = String(before);
  const afterKey = String(after);
  const beforeClassified = classificationCache[beforeKey] || generateLandCover(before);
  const afterClassified = classificationCache[afterKey] || generateLandCover(after);

  const changedMask = beforeClassified.neq(afterClassified);
  return beforeClassified.multiply(10).add(afterClassified).rename('transition').updateMask(changedMask);
}

function computeLinearTrend(values) {
  if (!Array.isArray(values) || values.length < 3) {
    return {
      slope: null,
      pValue: null
    };
  }

  const y = values.map((item) => Number(item.mean)).filter((value) => Number.isFinite(value));
  const n = y.length;
  if (n < 3) {
    return {
      slope: null,
      pValue: null
    };
  }

  const x = Array.from({ length: n }, (_, index) => index);
  const meanX = x.reduce((sum, value) => sum + value, 0) / n;
  const meanY = y.reduce((sum, value) => sum + value, 0) / n;

  let sxx = 0;
  let sxy = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = x[index] - meanX;
    sxx += dx * dx;
    sxy += dx * (y[index] - meanY);
  }

  if (sxx === 0) {
    return {
      slope: null,
      pValue: null
    };
  }

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const residualSumSquares = y.reduce((sum, value, index) => {
    const fitted = intercept + slope * x[index];
    return sum + (value - fitted) ** 2;
  }, 0);

  const degreesOfFreedom = n - 2;
  if (degreesOfFreedom <= 0) {
    return {
      slope: Number(slope.toFixed(6)),
      pValue: null
    };
  }

  const standardError = Math.sqrt((residualSumSquares / degreesOfFreedom) / sxx);
  if (!Number.isFinite(standardError) || standardError === 0) {
    return {
      slope: Number(slope.toFixed(6)),
      pValue: 0
    };
  }

  const tStatistic = slope / standardError;
  const pValue = 2 * (1 - jStat.studentt.cdf(Math.abs(tStatistic), degreesOfFreedom));

  return {
    slope: Number(slope.toFixed(6)),
    pValue: Number(pValue.toFixed(6))
  };
}

async function ensureEarthEngineInitialized() {
  if (!earthEngineInitPromise) {
    earthEngineInitPromise = initializeEarthEngine({
      keyPath: process.env.GEE_KEY_PATH,
      serviceAccountJson: process.env.GEE_SERVICE_ACCOUNT_JSON,
      serviceAccountJsonBase64: process.env.GEE_SERVICE_ACCOUNT_JSON_BASE64
    })
      .then(() => {
        console.log('Google Earth Engine initialized successfully.');
      })
      .catch((error) => {
        earthEngineInitPromise = null;
        throw error;
      });
  }

  return earthEngineInitPromise;
}

app.get('/ndvi-timeseries', async (req, res, next) => {
  try {
    const { lat, lng, startDate, endDate } = req.query;
    const latitude = Number(lat);
    const longitude = Number(lng);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      const error = new Error('Invalid lat. Expected number between -90 and 90.');
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      const error = new Error('Invalid lng. Expected number between -180 and 180.');
      error.statusCode = 400;
      throw error;
    }

    if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
      const error = new Error('Invalid dates. Expected YYYY-MM-DD for startDate and endDate.');
      error.statusCode = 400;
      throw error;
    }

    if (new Date(`${startDate}T00:00:00Z`) >= new Date(`${endDate}T00:00:00Z`)) {
      const error = new Error('startDate must be earlier than endDate.');
      error.statusCode = 400;
      throw error;
    }

    const data = await getOrSetResponseCache(
      makeCacheKey('ndvi-timeseries', { lat: latitude, lng: longitude, startDate, endDate }),
      () =>
        getNdviTimeSeries({
          lat: latitude,
          lng: longitude,
          startDate,
          endDate
        })
    );

    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

app.get('/urban-change', async (req, res, next) => {
  try {
    const { lat, lng, startDate, endDate } = req.query;
    const latitude = Number(lat);
    const longitude = Number(lng);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      const error = new Error('Invalid lat. Expected number between -90 and 90.');
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      const error = new Error('Invalid lng. Expected number between -180 and 180.');
      error.statusCode = 400;
      throw error;
    }

    if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
      const error = new Error('Invalid dates. Expected YYYY-MM-DD for startDate and endDate.');
      error.statusCode = 400;
      throw error;
    }

    if (new Date(`${startDate}T00:00:00Z`) >= new Date(`${endDate}T00:00:00Z`)) {
      const error = new Error('startDate must be earlier than endDate.');
      error.statusCode = 400;
      throw error;
    }

    const data = await getOrSetResponseCache(
      makeCacheKey('urban-change', { lat: latitude, lng: longitude, startDate, endDate }),
      () =>
        getUrbanChangeTimeSeries({
          lat: latitude,
          lng: longitude,
          startDate,
          endDate
        })
    );

    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

app.get('/temperature-trend', async (req, res, next) => {
  try {
    const { lat, lng, startDate, endDate } = req.query;
    const latitude = Number(lat);
    const longitude = Number(lng);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      const error = new Error('Invalid lat. Expected number between -90 and 90.');
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      const error = new Error('Invalid lng. Expected number between -180 and 180.');
      error.statusCode = 400;
      throw error;
    }

    if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
      const error = new Error('Invalid dates. Expected YYYY-MM-DD for startDate and endDate.');
      error.statusCode = 400;
      throw error;
    }

    if (new Date(`${startDate}T00:00:00Z`) >= new Date(`${endDate}T00:00:00Z`)) {
      const error = new Error('startDate must be earlier than endDate.');
      error.statusCode = 400;
      throw error;
    }

    const result = await getOrSetResponseCache(
      makeCacheKey('temperature-trend', { lat: latitude, lng: longitude, startDate, endDate }),
      async () => {
        const data = await getTemperatureTrendTimeSeries({
          lat: latitude,
          lng: longitude,
          startDate,
          endDate
        });
        return {
          series: data,
          trend: computeLinearTrend(data)
        };
      }
    );

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/rainfall-trend', async (req, res, next) => {
  try {
    const { lat, lng, startDate, endDate } = req.query;
    const latitude = Number(lat);
    const longitude = Number(lng);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      const error = new Error('Invalid lat. Expected number between -90 and 90.');
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      const error = new Error('Invalid lng. Expected number between -180 and 180.');
      error.statusCode = 400;
      throw error;
    }

    if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
      const error = new Error('Invalid dates. Expected YYYY-MM-DD for startDate and endDate.');
      error.statusCode = 400;
      throw error;
    }

    if (new Date(`${startDate}T00:00:00Z`) >= new Date(`${endDate}T00:00:00Z`)) {
      const error = new Error('startDate must be earlier than endDate.');
      error.statusCode = 400;
      throw error;
    }

    const data = await getOrSetResponseCache(
      makeCacheKey('rainfall-trend', { lat: latitude, lng: longitude, startDate, endDate }),
      () =>
        getRainfallTrendTimeSeries({
          lat: latitude,
          lng: longitude,
          startDate,
          endDate
        })
    );

    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

app.get('/land-change-map', async (req, res, next) => {
  try {
    const { lat, lng, beforeYear, afterYear, type = 'ndvi' } = req.query;
    const latitude = Number(lat);
    const longitude = Number(lng);
    const before = Number(beforeYear);
    const after = Number(afterYear);
    const indexType = String(type).toLowerCase();
    const supportedTypes = new Set(['ndvi', 'urban', 'water', 'heat']);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      const error = new Error('Invalid lat. Expected number between -90 and 90.');
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      const error = new Error('Invalid lng. Expected number between -180 and 180.');
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isInteger(before) || !Number.isInteger(after)) {
      const error = new Error('Invalid years. Expected integer beforeYear and afterYear.');
      error.statusCode = 400;
      throw error;
    }

    if (before < 2015 || after < 2015) {
      const error = new Error('Sentinel-2 coverage starts in 2015. Use years >= 2015.');
      error.statusCode = 400;
      throw error;
    }

    if (after <= before) {
      const error = new Error('afterYear must be greater than beforeYear.');
      error.statusCode = 400;
      throw error;
    }

    if (!supportedTypes.has(indexType)) {
      const error = new Error('Invalid type. Use one of: ndvi, urban, water, heat.');
      error.statusCode = 400;
      throw error;
    }

    const data = await getOrSetResponseCache(
      makeCacheKey('land-change-map', { lat: latitude, lng: longitude, beforeYear: before, afterYear: after, type: indexType }),
      () =>
        getLandChangeMap({
          lat: latitude,
          lng: longitude,
          beforeYear: before,
          afterYear: after,
          type: indexType
        })
    );

    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

app.get('/land-year-map', async (req, res, next) => {
  try {
    const { lat, lng, year } = req.query;
    const latitude = Number(lat);
    const longitude = Number(lng);
    const mapYear = Number(year);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      const error = new Error('Invalid lat. Expected number between -90 and 90.');
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      const error = new Error('Invalid lng. Expected number between -180 and 180.');
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isInteger(mapYear) || mapYear < 2015) {
      const error = new Error('Invalid year. Use an integer year >= 2015.');
      error.statusCode = 400;
      throw error;
    }

    const data = await getOrSetResponseCache(
      makeCacheKey('land-year-map', { lat: latitude, lng: longitude, year: mapYear }),
      () =>
        getLandYearMap({
          lat: latitude,
          lng: longitude,
          year: mapYear
        })
    );

    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

app.get('/land-cover-static', async (req, res, next) => {
  try {
    const { year } = req.query;
    const landCoverYear = Number(year);

    if (!Number.isInteger(landCoverYear) || landCoverYear < 2015) {
      const error = new Error('Invalid year. Use an integer year >= 2015.');
      error.statusCode = 400;
      throw error;
    }

    const result = await getOrSetResponseCache(
      makeCacheKey('land-cover-static', { year: landCoverYear }),
      async () => {
        const classified = generateLandCover(landCoverYear);
        void getLandCoverStats(landCoverYear).catch((statsError) => {
          console.error(`Failed to cache land-cover stats for year ${landCoverYear}:`, statsError);
        });
        const tileUrl = await getTileUrlForImage(classified, {
          min: 0,
          max: 4,
          palette: ['#2C7BB6', '#1A9641', '#FDE725', '#D7191C', '#A6A6A6']
        });
        return { tileUrl };
      }
    );

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/land-cover-stats', async (req, res, next) => {
  try {
    const { year } = req.query;
    const landCoverYear = Number(year);

    if (!Number.isInteger(landCoverYear) || landCoverYear < 2015) {
      const error = new Error('Invalid year. Use an integer year >= 2015.');
      error.statusCode = 400;
      throw error;
    }

    const stats = await getOrSetResponseCache(
      makeCacheKey('land-cover-stats', { year: landCoverYear }),
      () => getLandCoverStats(landCoverYear)
    );
    res.status(200).json(stats);
  } catch (error) {
    next(error);
  }
});

app.get('/district-stats', async (req, res, next) => {
  try {
    const { year, district } = req.query;
    const landCoverYear = Number(year);
    const districtName = String(district || '').trim();

    if (!Number.isInteger(landCoverYear) || landCoverYear < 2015) {
      const error = new Error('Invalid year. Use an integer year >= 2015.');
      error.statusCode = 400;
      throw error;
    }

    if (!districtName) {
      const error = new Error('district is required for /district-stats.');
      error.statusCode = 400;
      throw error;
    }

    const stats = await getDistrictLandCoverStats(landCoverYear, districtName);
    res.status(200).json(stats);
  } catch (error) {
    next(error);
  }
});

app.get('/land-cover-change-static', async (req, res, next) => {
  try {
    const { before, after } = parseChangeYears(req.query.beforeYear, req.query.afterYear);
    const result = await getOrSetResponseCache(
      makeCacheKey('land-cover-change-static', { beforeYear: before, afterYear: after }),
      async () => {
        const transitionMasked = getTransitionMaskedImage(before, after);
        const tileUrl = await getTileUrlForImage(transitionMasked, {
          min: 0,
          max: 44,
          palette: [
            '#440154',
            '#472d7b',
            '#3b528b',
            '#2c728e',
            '#21918c',
            '#27ad81',
            '#5cc863',
            '#aadc32',
            '#fde725'
          ]
        });
        return { tileUrl };
      }
    );

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/land-cover-transition-stats', async (req, res, next) => {
  try {
    const { before, after } = parseChangeYears(req.query.beforeYear, req.query.afterYear);
    const transitions = await getOrSetResponseCache(
      makeCacheKey('land-cover-transition-stats', { beforeYear: before, afterYear: after }),
      async () => {
        const transitionMasked = getTransitionMaskedImage(before, after);

        const histogramResult = await evaluateEeObject(
          transitionMasked.reduceRegion({
            reducer: ee.Reducer.frequencyHistogram(),
            geometry: getKeralaRegion(),
            scale: 30,
            maxPixels: 1e13,
            bestEffort: true,
            tileScale: 4
          })
        );

        const histogram = histogramResult?.transition || {};
        const pixelAreaKm2 = (30 * 30) / 1e6;
        const computedTransitions = {};

        for (const [encodedTransition, count] of Object.entries(histogram)) {
          const code = Number(encodedTransition);
          const pixelCount = Number(count);
          if (!Number.isFinite(code) || !Number.isFinite(pixelCount)) {
            continue;
          }

          const fromClass = Math.floor(code / 10);
          const toClass = code % 10;
          const key = `${fromClass}-${toClass}`;
          computedTransitions[key] = Number((pixelCount * pixelAreaKm2).toFixed(4));
        }

        return computedTransitions;
      }
    );

    res.status(200).json(transitions);
  } catch (error) {
    next(error);
  }
});

app.use((req, res, next) => {
  const error = new Error('Route not found');
  error.statusCode = 404;
  next(error);
});

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = statusCode === 500 ? 'Internal server error' : err.message;

  if (statusCode === 500) {
    console.error(err);
  }

  res.status(statusCode).json({
    error: {
      message
    }
  });
});

async function startServer() {
  try {
    await ensureEarthEngineInitialized();

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to initialize Google Earth Engine:', error);
    process.exit(1);
  }
}

if (isDirectRun) {
  startServer();
}

export default app;
