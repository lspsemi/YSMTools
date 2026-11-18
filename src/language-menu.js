// Top-bar language button and menu (第 47 节). Choosing another language
// saves it and reloads the page, because every string is built once at start.
import { tr, listLanguages, currentLanguage, saveLanguage } from './i18n.js';

const isDesktop = '__TAURI_INTERNALS__' in window;
const escapeHtml = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function openLanguageFolder() {
  const [{ invoke }, { revealItemInDir }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/plugin-opener')]);
  await revealItemInDir(await invoke('language_dir'));
}

// M3 basic dialog; resolves true when the user confirms.
function confirmReload() {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'md-dialog';
    dialog.innerHTML = `<form method="dialog"><h2>${tr('界面语言')}</h2><p class="md-dialog-supporting">${tr('切换语言会重新载入界面，当前模型需要重新导入。继续吗？')}</p><div class="md-dialog-actions"><button class="md-button text" value="cancel">${tr('取消')}</button><button class="md-button filled" value="ok">${tr('确定')}</button></div></form>`;
    dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'ok'); dialog.remove(); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * @param {Element} before  element the button is inserted in front of
 * @param {string} iconHtml  icon markup for the button
 * @param {() => boolean} hasModel  whether a reload would discard a loaded model
 * @param {(text: string) => void} toast
 */
export function setupLanguageMenu({ before, iconHtml, hasModel, toast }) {
  const current = currentLanguage();
  const picker = document.createElement('div');
  picker.className = 'language-picker';
  picker.innerHTML = `<button class="icon-button" id="language-button" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="${tr('界面语言')}" title="${escapeHtml(`${tr('语言')} · ${current.nativeName}`)}">${iconHtml}</button>`;
  before.before(picker);
  const button = picker.querySelector('button');
  let menu = null;

  const close = () => {
    if (!menu) return;
    const closing = menu; menu = null;
    button.setAttribute('aria-expanded', 'false');
    closing.classList.add('is-closing');
    setTimeout(() => closing.remove(), 100);
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const outside = event => { if (!picker.contains(event.target)) close(); };
  const onKey = event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); button.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const items = [...menu.querySelectorAll('[role^=menuitem]')], index = items.indexOf(document.activeElement);
      items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      event.preventDefault();
    }
  };

  async function choose(code) {
    close();
    if (code === current.code) return;
    if (hasModel() && !(await confirmReload())) return;
    saveLanguage(code);
    location.reload();
  }

  async function open() {
    const languages = await listLanguages();
    menu = document.createElement('div');
    menu.className = 'language-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', tr('界面语言'));
    menu.innerHTML = languages.map(language => {
      const detail = language.builtin ? tr('内置') : language.name !== language.nativeName ? language.name : '';
      return `<button type="button" role="menuitemradio" class="language-option" data-code="${escapeHtml(language.code)}" aria-checked="${language.code === current.code}"><span class="language-option-text"><span>${escapeHtml(language.nativeName)}</span>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</span></button>`;
    }).join('') + (isDesktop
      ? `<div class="language-menu-divider" role="separator"></div><button type="button" role="menuitem" class="language-option" data-action="folder"><span class="language-option-text"><span>${tr('打开语言文件夹')}</span></span></button>`
      : `<div class="language-menu-divider" role="separator"></div><p class="language-menu-note">${tr('语言文件放在软件目录的 lang 文件夹中')}</p>`);
    menu.addEventListener('click', event => {
      const item = event.target.closest('.language-option');
      if (!item) return;
      if (item.dataset.action === 'folder') { close(); openLanguageFolder().catch(error => toast(tr('打开失败：{0}', error.message || error))); return; }
      choose(item.dataset.code);
    });
    picker.append(menu);
    button.setAttribute('aria-expanded', 'true');
    (menu.querySelector('[aria-checked=true]') || menu.querySelector('[role^=menuitem]'))?.focus();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
  }

  let opening = false;
  button.addEventListener('click', () => {
    if (menu) { close(); return; }
    if (opening) return;
    opening = true;
    open().finally(() => { opening = false; });
  });
}
