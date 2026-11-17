import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContainer } from '../src/container.js';
import { FixedClock } from '../src/infrastructure/Clock.js';

export const CENTER = { lat: 4.6097, lng: -74.0817 };

export async function createTestContainer(overrides = {}) {
  const uploadsDir = await mkdtemp(join(tmpdir(), 'vias-uploads-'));
  const clock = new FixedClock('2026-10-01T12:00:00Z');
  const container = createContainer({
    databaseUrl: null, dataPath: null, uploadsDir, clock, workerPoolSize: 1, isrTtlMs: 60_000, groqApiKey: null, geminiApiKey: null, ...overrides,
  });
  await container.init();
  return container;
}

let counter = 0;
export async function createCitizen(container, name = 'Ciudadano') {
  counter++;
  return container.authService.createUser({ name, email: `c${counter}-${Date.now()}@test.co`, password: 'secreto1' });
}

export async function createOfficial(container) {
  counter++;
  return container.authService.createUser({ name: 'Funcionaria', email: `f${counter}@alcaldia.gov.co`, password: 'secreto1', role: 'OFFICIAL' });
}

export function buildJpegWithGps(lat, lng) {
  const tiff = Buffer.alloc(128);
  tiff.write('MM', 0, 'ascii');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x8825, 10);
  tiff.writeUInt16BE(4, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt32BE(26, 18);
  tiff.writeUInt32BE(0, 22);
  tiff.writeUInt16BE(4, 26);
  const entry = (index, tag, type, count, value, isAscii = false) => {
    const at = 28 + index * 12;
    tiff.writeUInt16BE(tag, at);
    tiff.writeUInt16BE(type, at + 2);
    tiff.writeUInt32BE(count, at + 4);
    if (isAscii) tiff.write(value, at + 8, 'ascii');
    else tiff.writeUInt32BE(value, at + 8);
  };
  entry(0, 1, 2, 2, lat < 0 ? 'S' : 'N', true);
  entry(1, 2, 5, 3, 80);
  entry(2, 3, 2, 2, lng < 0 ? 'W' : 'E', true);
  entry(3, 4, 5, 3, 104);
  tiff.writeUInt32BE(0, 28 + 4 * 12);
  const writeDms = (offset, decimal) => {
    const value = Math.abs(decimal);
    const degrees = Math.floor(value);
    const minutes = Math.floor((value - degrees) * 60);
    const seconds = Math.round(((value - degrees) * 60 - minutes) * 60 * 1000);
    [[degrees, 1], [minutes, 1], [seconds, 1000]].forEach(([num, den], i) => {
      tiff.writeUInt32BE(num, offset + i * 8);
      tiff.writeUInt32BE(den, offset + i * 8 + 4);
    });
  };
  writeDms(80, lat);
  writeDms(104, lng);

  const exifHeader = Buffer.from('Exif\0\0', 'binary');
  const segmentLength = 2 + exifHeader.length + tiff.length;
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(segmentLength, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, exifHeader, tiff, Buffer.from([0xff, 0xd9])]);
}

export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
