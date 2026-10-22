export function detectImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

export function readJpegGps(bytes) {
  try {
    if (detectImageType(bytes) !== 'image/jpeg') return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xd9 || marker === 0xda) return null;
      const size = view.getUint16(offset + 2);
      if (marker === 0xe1 && ascii(bytes, offset + 4, offset + 10) === 'Exif\0\0') {
        return parseTiffGps(bytes.subarray(offset + 10, offset + 2 + size));
      }
      offset += 2 + size;
    }
    return null;
  } catch {
    return null;
  }
}

function parseTiffGps(tiff) {
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const byteOrder = ascii(tiff, 0, 2);
  if (byteOrder !== 'II' && byteOrder !== 'MM') return null;
  const little = byteOrder === 'II';
  const u16 = (at) => view.getUint16(at, little);
  const u32 = (at) => view.getUint32(at, little);

  const entries = (ifdOffset) => {
    const map = new Map();
    const count = u16(ifdOffset);
    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12;
      map.set(u16(entry), entry);
    }
    return map;
  };

  const GPS_IFD_POINTER = 0x8825;
  const ifd0 = entries(u32(4));
  if (!ifd0.has(GPS_IFD_POINTER)) return null;
  const gps = entries(u32(ifd0.get(GPS_IFD_POINTER) + 8));

  const rational = (at) => {
    const denominator = u32(at + 4);
    return denominator ? u32(at) / denominator : 0;
  };
  const degrees = (tag) => {
    const entry = gps.get(tag);
    if (entry === undefined) return null;
    const at = u32(entry + 8);
    return rational(at) + rational(at + 8) / 60 + rational(at + 16) / 3600;
  };
  const reference = (tag) => {
    const entry = gps.get(tag);
    return entry === undefined ? '' : String.fromCharCode(tiff[entry + 8]);
  };

  const lat = degrees(2);
  const lng = degrees(4);
  if (lat === null || lng === null) return null;
  return {
    lat: reference(1) === 'S' ? -lat : lat,
    lng: reference(3) === 'W' ? -lng : lng,
  };
}

export function analyzeImage(bytes) {
  return {
    mimeType: detectImageType(bytes),
    bytes: bytes.length,
    gps: readJpegGps(bytes),
  };
}
