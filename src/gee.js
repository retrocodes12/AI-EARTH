import fs from 'node:fs/promises';
import ee from '@google/earthengine';
import getKeralaRegion from './keralaRegion.js';

function asError(error) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === 'string' ? error : 'Unknown Earth Engine error');
}

async function loadServiceAccountKey(keyPath) {
  if (!keyPath) {
    throw new Error('Missing GEE_KEY_PATH environment variable.');
  }

  const raw = await fs.readFile(keyPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Invalid service account key file: expected client_email and private_key.');
  }

  return parsed;
}

function parseServiceAccountJson(serviceAccountJson) {
  if (!serviceAccountJson) {
    return null;
  }

  const parsed = JSON.parse(serviceAccountJson);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Invalid GEE_SERVICE_ACCOUNT_JSON: expected client_email and private_key.');
  }

  return parsed;
}

function authenticateWithServiceAccount(privateKey) {
  return new Promise((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(
      privateKey,
      () => resolve(),
      (error) => reject(asError(error))
    );
  });
}

function initializeEeClient() {
  return new Promise((resolve, reject) => {
    ee.initialize(
      null,
      null,
      () => resolve(),
      (error) => reject(asError(error))
    );
  });
}

export async function initializeEarthEngine({ keyPath, serviceAccountJson } = {}) {
  const privateKey =
    parseServiceAccountJson(serviceAccountJson) || (await loadServiceAccountKey(keyPath));
  await authenticateWithServiceAccount(privateKey);
  await initializeEeClient();
}

function evaluateEeObject(eeObject) {
  return new Promise((resolve, reject) => {
    eeObject.evaluate((result, error) => {
      if (error) {
        reject(asError(error));
        return;
      }

      resolve(result);
    });
  });
}

function getMapIdForImage(image, visParams) {
  return new Promise((resolve, reject) => {
    image.getMapId(visParams, (mapId, error) => {
      if (error) {
        reject(asError(error));
        return;
      }

      if (!mapId) {
        reject(new Error('Failed to generate Earth Engine map ID.'));
        return;
      }

      resolve(mapId);
    });
  });
}

export async function getNdviTimeSeries({ lat, lng, startDate, endDate }) {
  const point = ee.Geometry.Point([lng, lat]);
  const start = ee.Date(startDate);
  const end = ee.Date(endDate);
  const monthCount = end.difference(start, 'month').ceil();

  const monthlyFeatures = ee.FeatureCollection(
    ee.List.sequence(0, monthCount.subtract(1)).map((offset) => {
      const monthStart = start.advance(ee.Number(offset), 'month');
      const monthEnd = monthStart.advance(1, 'month');

      const monthlyImage = ee
        .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(point)
        .filterDate(monthStart, monthEnd)
        .map((image) => image.normalizedDifference(['B8', 'B4']).rename('ndvi'))
        .mean();

      const stats = monthlyImage.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: point,
        scale: 10,
        bestEffort: true,
        maxPixels: 1e9
      });

      return ee.Feature(null, {
        date: monthStart.format('YYYY-MM'),
        value: stats.get('ndvi')
      });
    })
  ).filter(ee.Filter.notNull(['value']));

  const result = await evaluateEeObject(monthlyFeatures);
  const features = Array.isArray(result?.features) ? result.features : [];

  return features.map((feature) => ({
    date: feature.properties.date,
    value: Number(feature.properties.value)
  }));
}

export async function getUrbanChangeTimeSeries({ lat, lng, startDate, endDate }) {
  const point = ee.Geometry.Point([lng, lat]);
  const start = ee.Date(startDate);
  const end = ee.Date(endDate);
  const startYear = ee.Number.parse(start.format('YYYY'));
  const endYear = ee.Number.parse(end.advance(-1, 'day').format('YYYY'));

  const yearlyFeatures = ee.FeatureCollection(
    ee.List.sequence(startYear, endYear).map((yearValue) => {
      const year = ee.Number(yearValue);
      const yearStartBase = ee.Date.fromYMD(year, 1, 1);
      const yearEndBase = yearStartBase.advance(1, 'year');
      const yearStart = ee.Date(
        ee.Algorithms.If(yearStartBase.millis().lt(start.millis()), start, yearStartBase)
      );
      const yearEnd = ee.Date(
        ee.Algorithms.If(yearEndBase.millis().gt(end.millis()), end, yearEndBase)
      );

      const yearlyImage = ee
        .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(point)
        .filterDate(yearStart, yearEnd)
        .map((image) => image.normalizedDifference(['B11', 'B8']).rename('ndbi'))
        .mean();

      const stats = yearlyImage.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: point,
        scale: 20,
        bestEffort: true,
        maxPixels: 1e9
      });

      return ee.Feature(null, {
        date: ee.Date.fromYMD(year, 1, 1).format('YYYY'),
        value: stats.get('ndbi')
      });
    })
  ).filter(ee.Filter.notNull(['value']));

  const result = await evaluateEeObject(yearlyFeatures);
  const features = Array.isArray(result?.features) ? result.features : [];

  return features.map((feature) => ({
    date: feature.properties.date,
    value: Number(feature.properties.value)
  }));
}

export async function getTemperatureTrendTimeSeries({ lat, lng, startDate, endDate }) {
  const point = ee.Geometry.Point([lng, lat]);
  const start = ee.Date(startDate);
  const end = ee.Date(endDate);
  const monthCount = end.difference(start, 'month').ceil();

  const monthlyFeatures = ee.FeatureCollection(
    ee.List.sequence(0, monthCount.subtract(1)).map((offset) => {
      const monthStart = start.advance(ee.Number(offset), 'month');
      const monthEnd = monthStart.advance(1, 'month');

      const temperatureCollection = ee
        .ImageCollection('MODIS/061/MOD11A2')
        .filterBounds(point)
        .filterDate(monthStart, monthEnd)
        .select('LST_Day_1km')
        .map((image) => image.multiply(0.02).subtract(273.15).rename('temp_c'));

      const meanStats = temperatureCollection.mean().reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: point,
        scale: 1000,
        bestEffort: true,
        maxPixels: 1e9
      });
      const maxStats = temperatureCollection.max().reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: point,
        scale: 1000,
        bestEffort: true,
        maxPixels: 1e9
      });
      const minStats = temperatureCollection.min().reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: point,
        scale: 1000,
        bestEffort: true,
        maxPixels: 1e9
      });

      return ee.Feature(null, {
        date: monthStart.format('YYYY-MM'),
        mean: meanStats.get('temp_c'),
        max: maxStats.get('temp_c'),
        min: minStats.get('temp_c')
      });
    })
  ).filter(ee.Filter.notNull(['mean', 'max', 'min']));

  const result = await evaluateEeObject(monthlyFeatures);
  const features = Array.isArray(result?.features) ? result.features : [];

  return features.map((feature) => ({
    date: feature.properties.date,
    mean: Number(feature.properties.mean),
    max: Number(feature.properties.max),
    min: Number(feature.properties.min)
  }));
}

export async function getRainfallTrendTimeSeries({ lat, lng, startDate, endDate }) {
  const point = ee.Geometry.Point([lng, lat]);
  const start = ee.Date(startDate);
  const end = ee.Date(endDate);
  const monthCount = end.difference(start, 'month').ceil();

  const monthlyFeatures = ee.FeatureCollection(
    ee.List.sequence(0, monthCount.subtract(1)).map((offset) => {
      const monthStart = start.advance(ee.Number(offset), 'month');
      const monthEnd = monthStart.advance(1, 'month');

      const monthlyRainfall = ee
        .ImageCollection('UCSB-CHG/CHIRPS/DAILY')
        .filterBounds(point)
        .filterDate(monthStart, monthEnd)
        .select('precipitation')
        .sum()
        .rename('rain_mm');

      const stats = monthlyRainfall.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: point,
        scale: 5566,
        bestEffort: true,
        maxPixels: 1e9
      });

      return ee.Feature(null, {
        date: monthStart.format('YYYY-MM'),
        value: stats.get('rain_mm')
      });
    })
  ).filter(ee.Filter.notNull(['value']));

  const result = await evaluateEeObject(monthlyFeatures);
  const features = Array.isArray(result?.features) ? result.features : [];

  return features.map((feature) => ({
    date: feature.properties.date,
    value: Number(feature.properties.value)
  }));
}

export async function getLandChangeMap({ lat, lng, beforeYear, afterYear, type = 'ndvi' }) {
  const region = getKeralaRegion();
  const startBefore = ee.Date.fromYMD(beforeYear, 1, 1);
  const endBefore = startBefore.advance(1, 'year');
  const startAfter = ee.Date.fromYMD(afterYear, 1, 1);
  const endAfter = startAfter.advance(1, 'year');

  const s2Collection = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(region);
  const modisCollection = ee.ImageCollection('MODIS/061/MOD11A2').filterBounds(region);

  const indexConfig = {
    ndvi: {
      bandName: 'ndvi_change',
      visualization: {
        min: -0.5,
        max: 0.5,
        palette: ['8b0000', 'fdbb84', 'ffffbf', 'a1d99b', '006d2c']
      },
      getBeforeImage: () =>
        s2Collection
          .filterDate(startBefore, endBefore)
          .map((image) => image.normalizedDifference(['B8', 'B4']).rename('index'))
          .mean(),
      getAfterImage: () =>
        s2Collection
          .filterDate(startAfter, endAfter)
          .map((image) => image.normalizedDifference(['B8', 'B4']).rename('index'))
          .mean()
    },
    urban: {
      bandName: 'urban_change',
      visualization: {
        min: -0.4,
        max: 0.4,
        palette: ['0b2a45', '74add1', 'ffffbf', 'f46d43', 'a50026']
      },
      getBeforeImage: () =>
        s2Collection
          .filterDate(startBefore, endBefore)
          .map((image) => image.normalizedDifference(['B11', 'B8']).rename('index'))
          .mean(),
      getAfterImage: () =>
        s2Collection
          .filterDate(startAfter, endAfter)
          .map((image) => image.normalizedDifference(['B11', 'B8']).rename('index'))
          .mean()
    },
    water: {
      bandName: 'water_change',
      visualization: {
        min: -0.5,
        max: 0.5,
        palette: ['7f0000', 'd73027', 'fefefe', '67a9cf', '08306b']
      },
      getBeforeImage: () =>
        s2Collection
          .filterDate(startBefore, endBefore)
          .map((image) => image.normalizedDifference(['B3', 'B8']).rename('index'))
          .mean(),
      getAfterImage: () =>
        s2Collection
          .filterDate(startAfter, endAfter)
          .map((image) => image.normalizedDifference(['B3', 'B8']).rename('index'))
          .mean()
    },
    heat: {
      bandName: 'heat_change',
      visualization: {
        min: -8,
        max: 8,
        palette: ['2c7bb6', 'abd9e9', 'ffffbf', 'fdae61', 'd7191c']
      },
      getBeforeImage: () =>
        modisCollection
          .filterDate(startBefore, endBefore)
          .select('LST_Day_1km')
          .map((image) => image.multiply(0.02).subtract(273.15).rename('index'))
          .mean(),
      getAfterImage: () =>
        modisCollection
          .filterDate(startAfter, endAfter)
          .select('LST_Day_1km')
          .map((image) => image.multiply(0.02).subtract(273.15).rename('index'))
          .mean()
    }
  };

  const selected = indexConfig[type] || indexConfig.ndvi;
  const beforeImage = selected.getBeforeImage();
  const afterImage = selected.getAfterImage();
  const changeImage = afterImage.subtract(beforeImage).rename(selected.bandName).clip(region);

  const mapId = await getMapIdForImage(changeImage, selected.visualization);
  const tileUrl = mapId.urlFormat || mapId.formatTileUrl('{x}', '{y}', '{z}');

  return {
    tileUrl,
    visParams: selected.visualization
  };
}

export async function getLandYearMap({ lat, lng, year }) {
  const region = getKeralaRegion();
  const start = ee.Date.fromYMD(year, 1, 1);
  const end = start.advance(1, 'year');

  const ndviImage = ee
    .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(region)
    .filterDate(start, end)
    .map((image) => image.normalizedDifference(['B8', 'B4']).rename('ndvi'))
    .mean()
    .clip(region);

  const visualization = {
    min: 0,
    max: 0.8,
    palette: ['8d5524', 'd1a15b', 'f1e3a3', '8fd694', '2d6a4f']
  };
  const mapId = await getMapIdForImage(ndviImage, visualization);
  const tileUrl = mapId.urlFormat || mapId.formatTileUrl('{x}', '{y}', '{z}');

  return {
    tileUrl,
    visParams: visualization
  };
}
