import proj4 from 'proj4';

const ISN93 = '+proj=lcc +lat_1=64.25 +lat_2=65.75 +lat_0=65 +lon_0=-19 +x_0=500000 +y_0=500000 +ellps=GRS80 +units=m +no_defs';
const WGS84 = 'EPSG:4326';

proj4.defs('EPSG:3057', ISN93);

export function isn93ToWgs84(x: number, y: number): [number, number] {
  const [lon, lat] = proj4('EPSG:3057', WGS84, [x, y]);
  return [lon, lat];
}

export function wgs84ToIsn93(lon: number, lat: number): [number, number] {
  const [x, y] = proj4(WGS84, 'EPSG:3057', [lon, lat]);
  return [x, y];
}
