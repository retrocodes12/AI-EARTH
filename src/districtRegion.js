import ee from '@google/earthengine';

function getKeralaDistricts() {
  return ee
    .FeatureCollection('FAO/GAUL/2015/level2')
    .filter(ee.Filter.eq('ADM0_NAME', 'India'))
    .filter(ee.Filter.eq('ADM1_NAME', 'Kerala'));
}

export { getKeralaDistricts };
export default getKeralaDistricts;
