import { Hct, QuantizerCelebi, Score, SchemeContent, hexFromArgb } from '@material/material-color-utilities';

// Derives Material 3 color tokens from a model texture, weighted by the
// visible model surface each texel covers. Runs in a worker so
// decoding, quantizing and scheme generation never block model loading or
// the 3D view; the page only swaps the resulting CSS custom properties.

const SAMPLE_SIZE = 256;
// Weighted texels are expanded to about this many samples for the quantizer.
const WEIGHTED_SAMPLES = 200000;
// --md-sys-color-* tokens defined in style.css → DynamicScheme getters.
const TOKENS = {
  'primary': 'primary', 'on-primary': 'onPrimary', 'primary-container': 'primaryContainer', 'on-primary-container': 'onPrimaryContainer',
  'secondary': 'secondary', 'on-secondary': 'onSecondary', 'secondary-container': 'secondaryContainer', 'on-secondary-container': 'onSecondaryContainer',
  'tertiary': 'tertiary', 'tertiary-container': 'tertiaryContainer', 'on-tertiary-container': 'onTertiaryContainer',
  'error': 'error',
  'surface': 'surface', 'surface-container-lowest': 'surfaceContainerLowest', 'surface-container-low': 'surfaceContainerLow',
  'surface-container': 'surfaceContainer', 'surface-container-high': 'surfaceContainerHigh', 'surface-container-highest': 'surfaceContainerHighest',
  'on-surface': 'onSurface', 'on-surface-variant': 'onSurfaceVariant', 'outline': 'outline', 'outline-variant': 'outlineVariant',
  'inverse-surface': 'inverseSurface', 'inverse-on-surface': 'inverseOnSurface', 'inverse-primary': 'inversePrimary',
};

async function textureImage(blob) {
  const bitmap = await createImageBitmap(blob);
  // Skin textures are pixel art: sample without smoothing so colors stay pure.
  const scale = Math.min(1, SAMPLE_SIZE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

const argb = (data, i) => (0xff000000 | (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) >>> 0;

// Unused texture space is transparent; only opaque texels describe the model.
function opaquePixels({ data }) {
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128) pixels.push(argb(data, i));
  return pixels;
}

// Spreads each visible face's model-space area over the texels its UV rect
// covers, so a color counts as much as it shows on the model: hidden parts,
// spare expression frames and unused atlas space drop out, and a small UV
// region stretched over a large face counts for its size on the model.
function coveragePixels({ width, height, data }, coverage) {
  const weights = new Float64Array(width * height);
  for (let f = 0; f < coverage.length; f += 5) {
    const u0 = coverage[f] * width, v0 = coverage[f + 1] * height, u1 = coverage[f + 2] * width, v1 = coverage[f + 3] * height;
    // Faces thinner than a sample still land on the texel under their center.
    let x0 = Math.floor(u0), x1 = Math.ceil(u1), y0 = Math.floor(v0), y1 = Math.ceil(v1);
    if (x1 <= x0) { x0 = Math.floor((u0 + u1) / 2); x1 = x0 + 1; }
    if (y1 <= y0) { y0 = Math.floor((v0 + v1) / 2); y1 = y0 + 1; }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(width, x1); y1 = Math.min(height, y1);
    if (x1 <= x0 || y1 <= y0) continue;
    const weight = coverage[f + 4] / ((x1 - x0) * (y1 - y0));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) weights[y * width + x] += weight;
  }
  let total = 0;
  for (let p = 0; p < weights.length; p++) if (data[p * 4 + 3] < 128) weights[p] = 0; else total += weights[p];
  if (!(total > 0)) return [];
  // The quantizer counts repeated pixels; carry the rounding so small faces add up.
  const pixels = [], scale = WEIGHTED_SAMPLES / total;
  let carry = 0;
  for (let p = 0; p < weights.length; p++) {
    if (!weights[p]) continue;
    carry += weights[p] * scale;
    const count = Math.floor(carry), color = argb(data, p * 4);
    carry -= count;
    for (let n = 0; n < count; n++) pixels.push(color);
  }
  return pixels;
}

async function texturePixels(blob, coverage) {
  const image = await textureImage(blob);
  const weighted = coverage?.length ? coveragePixels(image, coverage) : [];
  // No usable coverage (e.g. every face transparent): fall back to the whole texture.
  return weighted.length ? weighted : opaquePixels(image);
}

function seedColor(pixels) {
  if (!pixels.length) return null;
  const colors = QuantizerCelebi.quantize(pixels, 128);
  const [scored] = Score.score(colors, { desired: 1, fallbackColorARGB: 0, filter: true });
  if (scored) return scored;
  // Mostly muted textures: fall back to the most suitable color if it still has some hue.
  const [any] = Score.score(colors, { desired: 1, fallbackColorARGB: 0, filter: false });
  return any && Hct.fromInt(any).chroma >= 8 ? any : null;
}

function tokens(seed, dark) {
  const scheme = new SchemeContent(Hct.fromInt(seed), dark, 0);
  return Object.fromEntries(Object.entries(TOKENS).map(([name, getter]) => [name, hexFromArgb(scheme[getter])]));
}

self.onmessage = async ({ data: { id, blob, coverage } }) => {
  try {
    const seed = seedColor(await texturePixels(blob, coverage));
    self.postMessage({ id, seed: seed === null ? null : hexFromArgb(seed), light: seed === null ? null : tokens(seed, false), dark: seed === null ? null : tokens(seed, true) });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
