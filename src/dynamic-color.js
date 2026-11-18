// "自动取色": recolors the whole interface from the loaded model's texture.
// The palette is computed in theme-color-worker.js once per texture, after the
// model has loaded and the page is idle, so it never slows loading or the 3D
// view. Applying it only replaces one <style> element of CSS custom properties.

import { LOGO_PALETTE_EVENT } from './app-logo.js';

let worker = null, requestId = 0, styleElement = null;
const cache = new WeakMap(); // texture Blob → Map(coverage key → worker result)

function getWorker() {
  if (!worker) worker = new Worker(new URL('./theme-color-worker.js', import.meta.url), { type: 'module' });
  return worker;
}

function idle() {
  return new Promise(resolve => (window.requestIdleCallback ? requestIdleCallback(() => resolve(), { timeout: 1500 }) : setTimeout(resolve, 200)));
}

// Cheap FNV-1a over the coverage floats: the same texture with other parts
// shown is a different palette.
function coverageKey(coverage) {
  if (!coverage?.length) return '';
  const words = new Uint32Array(coverage.buffer, coverage.byteOffset, coverage.length);
  let hash = 0x811c9dc5;
  for (const word of words) hash = Math.imul(hash ^ word, 0x01000193);
  return `${coverage.length}:${hash >>> 0}`;
}

function computePalette(blob, coverage) {
  const key = coverageKey(coverage);
  let entries = cache.get(blob);
  if (!entries) cache.set(blob, entries = new Map());
  const cached = entries.get(key);
  if (cached) return Promise.resolve(cached);
  const id = ++requestId, target = getWorker();
  return new Promise((resolve, reject) => {
    const onMessage = ({ data }) => {
      if (data.id !== id) return;
      target.removeEventListener('message', onMessage);
      if (data.error) reject(new Error(data.error));
      else { entries.set(key, data); resolve(data); }
    };
    target.addEventListener('message', onMessage);
    target.postMessage({ id, blob, coverage });
  });
}

// The app logo always uses the light scheme (see --ysm-logo-* in style.css).
const LOGO_TOKENS = ['primary', 'inverse-primary', 'outline', 'outline-variant', 'surface-container-lowest', 'surface-container-low'];
const logoDeclarations = light => LOGO_TOKENS.map(name => `--ysm-logo-${name}:${light[name]};`).join('');

function declarations(tokens) {
  return Object.entries(tokens).map(([name, value]) => `--md-sys-color-${name}:${value};`).join('');
}

// Cross-fade the change when the browser supports view transitions.
function swap(update) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && document.startViewTransition && document.visibilityState === 'visible') {
    // A newer swap aborts a running transition; the update still runs, so the rejections are expected.
    try { const transition = document.startViewTransition(update); for (const settled of [transition.ready, transition.updateCallbackDone, transition.finished]) settled?.catch(() => {}); return; } catch { /* fall through */ }
  }
  update();
}

function applyPalette(palette) {
  swap(() => {
    if (!palette) { styleElement?.remove(); styleElement = null; delete document.documentElement.dataset.dynamicColor; window.dispatchEvent(new Event(LOGO_PALETTE_EVENT)); return; }
    if (!styleElement) { styleElement = document.createElement('style'); styleElement.id = 'dynamic-color'; document.head.append(styleElement); }
    // :root[data-theme=…] outranks the static [data-theme=dark] tokens.
    styleElement.textContent = `:root[data-theme=light]{${declarations(palette.light)}}:root[data-theme=dark]{${declarations(palette.dark)}}:root:root{${logoDeclarations(palette.light)}}`;
    document.documentElement.dataset.dynamicColor = palette.seed;
    window.dispatchEvent(new Event(LOGO_PALETTE_EVENT));
  });
}

let current = 0;
/**
 * Applies the palette of `blob` (a texture file), or restores the default
 * colors when blob is null. `coverage` ([u0,v0,u1,v1,area]×n from
 * visibleTextureCoverage) weights texels by the visible model surface they
 * cover; without it every opaque texel counts once. Resolves to 'model', 'default' (no suitable
 * color in the texture) or 'off'; stale calls resolve to null.
 */
export async function updateDynamicColor(blob, coverage = null) {
  const token = ++current;
  if (!blob) { applyPalette(null); return 'off'; }
  await idle();
  if (token !== current) return null;
  let palette = null;
  try { palette = await computePalette(blob, coverage); } catch (error) { console.warn('Could not derive interface colors from the texture:', error); }
  if (token !== current) return null;
  applyPalette(palette?.seed ? palette : null);
  return palette?.seed ? 'model' : 'default';
}
