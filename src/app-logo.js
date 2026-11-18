// App logo: an oblique box whose faces are tinted from the interface palette.
// Colors come from the --ysm-logo-* custom properties in style.css. They copy
// the LIGHT scheme only (dynamic-color.js refreshes them from the model's light
// palette), so the logo stays light in the dark theme too. The favicon is the
// same drawing with the colors resolved, redrawn whenever the palette changes.

export const LOGO_PALETTE_EVENT = 'ysm-palette-change';

const VIEW_BOX = '-6 -6 510 490';
const FACES = [
  // [name, points, gradient start x, gradient end x]
  ['top', '5,3 283,3 493,213 215,213', 5, 493],
  ['left', '5,3 215,213 215,473 5,263', 5, 215],
  ['front', '215,213 493,213 493,473 215,473', 215, 493],
];
const STOPS = ['0', '1'];
let serial = 0;

function svgMarkup(color, { idPrefix, className = '', stroke = 'var(--ysm-logo-stroke)', strokeWidth = 1.5, scaleStroke = false, title = '' }) {
  const gradients = FACES.map(([name, , x1, x2]) => `<linearGradient id="${idPrefix}-${name}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="0" x2="${x2}" y2="0">${STOPS.map((stop, i) => `<stop offset="${i}" style="stop-color:${color(`${name}-${stop}`)}"/>`).join('')}</linearGradient>`).join('');
  // Inline logos keep a hairline at any size; the favicon scales its stroke with the drawing.
  const effect = scaleStroke ? '' : ' vector-effect="non-scaling-stroke"';
  const faces = FACES.map(([name, points]) => `<polygon points="${points}" fill="url(#${idPrefix}-${name})"${effect}/>`).join('');
  const label = title ? `role="img" aria-label="${title}"` : 'aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_BOX}"${className ? ` class="${className}"` : ''} ${label}><defs>${gradients}</defs><g stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round">${faces}</g></svg>`;
}

/** Inline logo that follows the palette live through CSS variables. */
export function logoSvg({ className = 'app-logo', title = '' } = {}) {
  return svgMarkup(token => `var(--ysm-logo-${token})`, { idPrefix: `ysm-logo-${++serial}`, className, title });
}

/** Standalone SVG with the current colors baked in (for the favicon or files). */
export function resolvedLogoSvg() {
  const style = getComputedStyle(document.documentElement);
  const value = name => style.getPropertyValue(`--ysm-logo-${name}`).trim();
  return svgMarkup(value, { idPrefix: 'logo', stroke: value('stroke'), strokeWidth: 12, scaleStroke: true });
}

function updateFavicon() {
  let link = document.querySelector('link[rel~=icon]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.append(link); }
  link.type = 'image/svg+xml';
  link.href = `data:image/svg+xml,${encodeURIComponent(resolvedLogoSvg())}`;
}

/** Draws the favicon now and again after every palette change. */
export function setupLogoFavicon() {
  updateFavicon();
  // The event fires right after the new colors are in place, so they resolve synchronously.
  window.addEventListener(LOGO_PALETTE_EVENT, updateFavicon);
}
