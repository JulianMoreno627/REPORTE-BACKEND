export const EARTH_RADIUS_M = 6_371_008.8;
const METERS_PER_DEGREE_LAT = 111_320;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function metersToLatDegrees(meters) {
  return meters / METERS_PER_DEGREE_LAT;
}

export function metersToLngDegrees(meters, atLat) {
  return meters / (METERS_PER_DEGREE_LAT * Math.max(Math.cos(toRadians(atLat)), 1e-6));
}

export function offsetMeters({ lat, lng }, east, north) {
  return { lat: lat + metersToLatDegrees(north), lng: lng + metersToLngDegrees(east, lat) };
}

export function centroid(points) {
  const total = points.reduce((acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }), { lat: 0, lng: 0 });
  return { lat: total.lat / points.length, lng: total.lng / points.length };
}

export function parseBoundingBox(value) {
  if (!value) return null;
  const parts = String(value).split(',').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [minLat, minLng, maxLat, maxLng] = parts;
  return { minLat, minLng, maxLat, maxLng };
}

export function insideBoundingBox({ lat, lng }, box) {
  return !box || (lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng);
}
