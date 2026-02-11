import ee from '@google/earthengine';

function getKeralaRegion() {
  return ee
    .FeatureCollection('FAO/GAUL/2015/level1')
    .filter(ee.Filter.eq('ADM0_NAME', 'India'))
    .filter(ee.Filter.eq('ADM1_NAME', 'Kerala'))
    .geometry();
}

export { getKeralaRegion };
export default getKeralaRegion;
