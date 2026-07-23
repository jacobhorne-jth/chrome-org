#!/usr/bin/env node
/**
 * Renders the toolbar/extension icons into apps/extension/public/icons/.
 *
 * The mark is a rounded blue tile holding a side-panel glyph: one tall bar on
 * the left (the panel) and two stacked bars on the right (the workspaces it
 * lists). Everything is expressed in unit coordinates so the same drawing
 * survives 16px -> 128px, and coverage is supersampled 4x4 per pixel so the
 * small sizes stay smooth without a rasteriser dependency.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../apps/extension/public/icons",
);
const SIZES = [16, 32, 48, 128];
const SUBSAMPLES = 4;

/** Gradient endpoints for the tile, top -> bottom. */
const TILE_TOP = [0x4f, 0x8d, 0xf7];
const TILE_BOTTOM = [0x25, 0x63, 0xd8];
const GLYPH = [0xff, 0xff, 0xff];

/** Rounded rectangles in unit space: [x0, y0, x1, y1, radius]. */
const TILE = [0.02, 0.02, 0.98, 0.98, 0.24];
const BARS = [
  [0.2, 0.22, 0.4, 0.78, 0.06],
  [0.48, 0.22, 0.8, 0.42, 0.06],
  [0.48, 0.58, 0.8, 0.78, 0.06],
];

/** Signed distance to a rounded rect; negative inside. */
function roundedRectDistance(x, y, [x0, y0, x1, y1, radius]) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = Math.max((x1 - x0) / 2 - radius, 0);
  const hy = Math.max((y1 - y0) / 2 - radius, 0);
  const dx = Math.max(Math.abs(x - cx) - hx, 0);
  const dy = Math.max(Math.abs(y - cy) - hy, 0);
  return Math.hypot(dx, dy) - radius;
}

function coverage(px, py, size, shape) {
  let hits = 0;
  for (let sy = 0; sy < SUBSAMPLES; sy += 1) {
    for (let sx = 0; sx < SUBSAMPLES; sx += 1) {
      const x = (px + (sx + 0.5) / SUBSAMPLES) / size;
      const y = (py + (sy + 0.5) / SUBSAMPLES) / size;
      if (roundedRectDistance(x, y, shape) <= 0) hits += 1;
    }
  }
  return hits / (SUBSAMPLES * SUBSAMPLES);
}

function mix(a, b, t) {
  return a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));
}

function renderRgba(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const tileAlpha = coverage(px, py, size, TILE);
      let glyphAlpha = 0;
      for (const bar of BARS) {
        glyphAlpha = Math.max(glyphAlpha, coverage(px, py, size, bar));
      }
      glyphAlpha = Math.min(glyphAlpha, tileAlpha);

      const base = mix(TILE_TOP, TILE_BOTTOM, (py + 0.5) / size);
      const [r, g, b] = mix(base, GLYPH, tileAlpha > 0 ? glyphAlpha / tileAlpha : 0);
      const offset = (py * size + px) * 4;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = Math.round(tileAlpha * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  // bytes 10-12: deflate compression, adaptive filtering, no interlace (all 0)

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, encodePng(size, renderRgba(size)));
  console.log(`wrote ${file}`);
}
