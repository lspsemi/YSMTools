// 关于 page easter egg (第 73 节): clicking the logo gives it a random new color;
// after 10 clicks a toast congratulates the user, after 20 confetti bursts from
// the logo and a toast asks them to go load a model.
// The count lives for one app run: sessionStorage survives the reload done by a
// language switch but is cleared when the app (or the browser tab) closes.

const COUNT_KEY = 'ysm-about-logo-clicks';
const FOUND_AT = 10, CONFETTI_AT = 20;
let memoryCount = 0;

function readCount() {
  try { return Number(sessionStorage.getItem(COUNT_KEY)) || 0; } catch { return memoryCount; }
}
function writeCount(value) {
  memoryCount = value;
  try { sessionStorage.setItem(COUNT_KEY, String(value)); } catch { /* memory only */ }
}

// A light palette for one hue, the same roles as the --ysm-logo-* base tokens.
function paletteFor(hue) {
  return {
    primary: `oklch(0.48 0.19 ${hue})`,
    'inverse-primary': `oklch(0.84 0.11 ${hue})`,
    outline: `oklch(0.55 0.03 ${hue})`,
    'outline-variant': `oklch(0.83 0.04 ${hue})`,
    'surface-container-lowest': '#ffffff',
    'surface-container-low': `oklch(0.96 0.02 ${hue})`,
  };
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function confettiBurst(origin) {
  if (reducedMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const resize = () => { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; };
  resize();
  const ctx = canvas.getContext('2d');
  const style = getComputedStyle(document.documentElement);
  const tokens = ['primary', 'secondary', 'tertiary', 'error', 'primary-container', 'tertiary-container'];
  const colors = tokens.map(name => style.getPropertyValue(`--md-sys-color-${name}`).trim()).filter(Boolean);
  colors.push('#ffca28', '#42a5f5', '#66bb6a', '#ef5350');
  const pieces = Array.from({ length: 140 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const speed = 380 + Math.random() * 520;
    return {
      x: origin.x, y: origin.y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      w: 6 + Math.random() * 6, h: 3 + Math.random() * 5,
      rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 14,
      flip: Math.random() * Math.PI, flipSpeed: 6 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  });
  const LIFE = 2.6;
  let last = performance.now(), age = 0;
  const frame = now => {
    const dt = Math.min((now - last) / 1000, 0.05); last = now; age += dt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, Math.min(1, (LIFE - age) / 0.6));
    for (const p of pieces) {
      p.vy += 900 * dt; p.vx *= 1 - 1.2 * dt; p.vy *= 1 - 0.9 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt; p.flip += p.flipSpeed * dt;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.flip));
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    if (age < LIFE) requestAnimationFrame(frame);
    else { removeEventListener('resize', resize); canvas.remove(); }
  };
  addEventListener('resize', resize);
  requestAnimationFrame(frame);
}

/** Wires the easter egg to the 关于 page logo button. */
export function setupAboutEasterEgg(button, { toast, tr }) {
  let hue = null;
  button.addEventListener('click', () => {
    // A hue at least 60° away from the current one, so every click visibly changes.
    const next = hue === null ? Math.random() * 360 : (hue + 60 + Math.random() * 240) % 360;
    hue = next;
    for (const [name, value] of Object.entries(paletteFor(Math.round(next)))) button.style.setProperty(`--ysm-logo-${name}`, value);
    button.classList.add('is-recolored');
    button.classList.remove('is-bouncing'); void button.offsetWidth; button.classList.add('is-bouncing');

    const count = readCount() + 1;
    writeCount(count);
    if (count > CONFETTI_AT) {
      const rect = button.getBoundingClientRect();
      confettiBurst({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      toast(tr('别点啦，快去加载模型吧。'));
    } else if (count === FOUND_AT + 1) toast(tr('恭喜你发现了彩蛋'));
  });
}
