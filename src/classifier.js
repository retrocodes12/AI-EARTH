import ee from '@google/earthengine';
import getKeralaRegion from './keralaRegion.js';

const predictorBands = ['B2', 'B3', 'B4', 'B8', 'B11', 'NDVI', 'NDWI', 'NDBI'];
let cachedClassifier = null;

function buildFeatureImage2020(region) {
  const sentinel2020 = ee
    .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(region)
    .filterDate('2020-01-01', '2021-01-01')
    .median()
    .select(['B2', 'B3', 'B4', 'B8', 'B11']);

  const ndvi = sentinel2020.normalizedDifference(['B8', 'B4']).rename('NDVI');
  const ndwi = sentinel2020.normalizedDifference(['B3', 'B8']).rename('NDWI');
  const ndbi = sentinel2020.normalizedDifference(['B11', 'B8']).rename('NDBI');

  return sentinel2020.addBands([ndvi, ndwi, ndbi]);
}

function buildClassLabels(region) {
  return ee
    .ImageCollection('ESA/WorldCover/v100')
    .first()
    .select('Map')
    .remap(
      [80, 10, 95, 40, 50, 60], // Water, Tree cover, Mangroves, Cropland, Built-up, Bare
      [0, 1, 1, 2, 3, 4],
      -1
    )
    .rename('label')
    .clip(region);
}

function getTrainingPoints(featureImage, labels, region) {
  const trainingImage = featureImage.addBands(labels).updateMask(labels.neq(-1));

  return trainingImage.stratifiedSample({
    region,
    scale: 30,
    numPoints: 6000,
    classBand: 'label',
    classValues: [0, 1, 2, 3, 4],
    classPoints: [1200, 1200, 1200, 1200, 1200],
    geometries: false,
    tileScale: 4,
    seed: 42
  });
}

function getTrainedClassifier() {
  if (cachedClassifier) {
    return cachedClassifier;
  }

  const region = getKeralaRegion();
  const featureImage = buildFeatureImage2020(region);
  const labels = buildClassLabels(region);
  const trainingPoints = getTrainingPoints(featureImage, labels, region);

  cachedClassifier = ee.Classifier.smileRandomForest(70).train({
    features: trainingPoints,
    classProperty: 'label',
    inputProperties: predictorBands
  });

  return cachedClassifier;
}

export { getTrainedClassifier, predictorBands };
export default getTrainedClassifier;
