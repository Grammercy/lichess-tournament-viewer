import { boardHtml } from './board.js';
import {
  boards2d, boards3d, pieces2d, pieces3d, defaults, defaultImage,
  createPreferenceStore, normalizePreferences, imageUrl, boardTheme, pieceSet, pieceCodes, pieceUrl,
} from './display-preferences.js';

export function initThemeMenu() {
  const $ = id => document.getElementById(id);
  const picker = $('theme-picker'), button = $('theme-button'), menu = $('theme-menu');
  const image = $('theme-image-url'), imageError = $('theme-image-error');
  const deviceTheme = window.matchMedia('(prefers-color-scheme: light)');
  let legacyStorage;
  try { legacyStorage = window.localStorage; } catch {}
  const store = createPreferenceStore(document, legacyStorage, location.protocol === 'https:');
  let preferences = store.read(), catalogDimension, previewFlipped = false;
  let lastCookie = document.cookie;
  const previewSquares = Array(64).fill(null);
  const backRank = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (let file = 0; file < 8; file++) {
    previewSquares[file] = `w${backRank[file]}`;
    previewSquares[file + 8] = 'wP';
    previewSquares[file + 48] = 'bP';
    previewSquares[file + 56] = `b${backRank[file]}`;
  }
  previewSquares[12] = null; previewSquares[28] = 'wP';
  previewSquares[52] = null; previewSquares[36] = 'bP';
  const previewPosition = { squares: previewSquares, last: { from: 12, to: 28 } };

  function preview() {
    $('theme-preview').innerHTML = boardHtml(previewPosition, previewFlipped);
  }
  function catalogs() {
    if (catalogDimension === preferences.dimension) return;
    catalogDimension = preferences.dimension;
    const boards = catalogDimension === '3d' ? boards3d : boards2d;
    const pieces = catalogDimension === '3d' ? pieces3d : pieces2d;
    $('board-themes').innerHTML = boards.map(item => `<button class="catalog-option board-option" type="button" role="radio" aria-checked="false" data-board-theme="${item.id}"><span class="board-swatch" style="background-image:url('${item.url}')" aria-hidden="true"></span><span>${item.name}</span></button>`).join('');
    $('piece-sets').innerHTML = pieces.map(item => `<button class="catalog-option piece-option" type="button" role="radio" aria-checked="false" data-piece-set="${item.id}"><img src="${pieceUrl(item, 'wN', catalogDimension, false, true)}" alt="" loading="lazy" width="48" height="48"><span>${item.name}</span></button>`).join('');
    $('board-theme-count').textContent = `${boards.length} themes`;
    $('piece-set-count').textContent = `${pieces.length} sets`;
  }
  function status(saved) {
    const consent = store.consent();
    const message = consent === 'allowed' ? (saved ? 'Preferences saved in a cookie.' : 'Your browser could not save the preference cookie.')
      : consent === 'declined' ? 'Changes apply for this visit.' : 'Choose whether to save your preferences.';
    if ($('preference-status').textContent !== message) $('preference-status').textContent = message;
  }
  function apply() {
    const light = preferences.mode === 'light' || (preferences.mode === 'system' && deviceTheme.matches);
    const theme = boardTheme(preferences), pieces = pieceSet(preferences);
    const custom = preferences.customColors && preferences.dimension === '2d';
    document.body.classList.toggle('light', light);
    document.body.classList.toggle('picture', preferences.picture);
    document.body.classList.toggle('boards-3d', preferences.dimension === '3d');
    document.body.classList.toggle('hide-coordinates', !preferences.coordinates);
    document.body.classList.toggle('hide-highlights', !preferences.highlights);
    document.body.dataset.theme = `${preferences.picture ? 'transp ' : ''}${preferences.mode}`;
    document.body.dataset.board = theme.id;
    document.body.dataset.pieceSet = pieces.id;
    document.documentElement.style.colorScheme = light ? 'light' : 'dark';
    const vars = {
      '--theme-image': `url(${JSON.stringify(preferences.image || defaultImage)})`,
      '--theme-image-opacity': preferences.opacity / 100,
      '--ui-roundness': `${preferences.roundness}px`,
      '--board-image': custom ? `repeating-conic-gradient(${preferences.darkSquare} 0% 25%,${preferences.lightSquare} 0% 50%)` : `url(${JSON.stringify(theme.url)})`,
      '--board-image-size': custom ? '25% 25%' : '100% 100%',
      '--board-light': custom ? preferences.lightSquare : theme.light,
      '--board-dark': custom ? preferences.darkSquare : theme.dark,
      '--board-opacity': preferences.boardOpacity / 100,
      '--board-brightness': preferences.brightness / 100,
      '--board-contrast': preferences.contrast / 100,
      '--board-hue': `${preferences.hue}deg`,
    };
    for (const code of pieceCodes) {
      vars[`--piece-${code}`] = `url(${JSON.stringify(pieceUrl(pieces, code, preferences.dimension))})`;
      vars[`--piece-${code}-flipped`] = `url(${JSON.stringify(pieceUrl(pieces, code, preferences.dimension, true))})`;
    }
    for (const [key, value] of Object.entries(vars)) document.body.style.setProperty(key, value);
    document.querySelector('meta[name="theme-color"]').content = light ? '#edebe9' : '#161512';
    for (const option of menu.querySelectorAll('[name="theme"]')) option.checked = option.value === preferences.mode;
    for (const option of menu.querySelectorAll('[name="board-dimension"]')) option.checked = option.value === preferences.dimension;
    for (const control of menu.querySelectorAll('[data-preference]')) {
      const value = preferences[control.dataset.preference];
      if (control.type === 'checkbox') control.checked = value;
      else control.value = value;
      if (control.type === 'range') {
        const output = $(control.id + '-value');
        if (output) output.value = `${value}${control.dataset.unit ?? '%'}`;
      }
    }
    $('theme-picture-settings').hidden = !preferences.picture;
    $('custom-board-controls').hidden = preferences.dimension === '3d';
    $('custom-square-colors').hidden = !preferences.customColors;
    $('game-grid').classList.toggle('compact', preferences.density === 'compact');
    $('game-grid').classList.toggle('comfortable', preferences.density === 'comfortable');
    for (const density of document.querySelectorAll('[data-density]')) density.classList.toggle('selected', density.dataset.density === preferences.density);
    catalogs();
    for (const option of menu.querySelectorAll('[data-board-theme], [data-piece-set]')) {
      const selected = option.hasAttribute('data-board-theme')
        ? !custom && option.dataset.boardTheme === preferences[`board${preferences.dimension}`]
        : option.dataset.pieceSet === preferences[`piece${preferences.dimension}`];
      option.setAttribute('aria-checked', String(selected));
      option.tabIndex = selected ? 0 : -1;
    }
    if (custom) $('board-themes').firstElementChild.tabIndex = 0;
    $('preview-board-name').textContent = custom ? 'Custom colors' : theme.name;
    $('preview-piece-name').textContent = `${pieces.name} · ${preferences.dimension.toUpperCase()}`;
    $('theme-preview').setAttribute('aria-label', `${custom ? 'Custom' : theme.name} board with ${pieces.name} pieces`);
  }
  function save() {
    apply();
    const saved = store.save(preferences);
    lastCookie = document.cookie;
    status(saved);
  }
  function set(key, value) {
    preferences = normalizePreferences({ ...preferences, [key]: value });
    save();
  }
  function close(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
  }
  button.addEventListener('click', () => {
    if (!menu.hidden) return close();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('[role="tab"][aria-selected="true"]').focus();
  });
  $('close-theme-menu').addEventListener('click', () => close(true));
  document.addEventListener('click', event => { if (!picker.contains(event.target)) close(); });
  document.addEventListener('focusin', event => { if (!picker.contains(event.target)) close(); });
  picker.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); event.stopPropagation(); close(true); }
  });
  const tabs = [...menu.querySelectorAll('[data-theme-tab]')];
  function selectTab(tab) {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected)); item.tabIndex = selected ? 0 : -1;
      $(item.getAttribute('aria-controls')).hidden = !selected;
    }
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next !== null) { event.preventDefault(); tabs[next].focus(); selectTab(tabs[next]); }
    });
  }
  for (const option of menu.querySelectorAll('[name="theme"]')) option.addEventListener('change', () => set('mode', option.value));
  for (const option of menu.querySelectorAll('[name="board-dimension"]')) option.addEventListener('change', () => set('dimension', option.value));
  for (const control of menu.querySelectorAll('[data-preference]')) control.addEventListener(control.type === 'range' || control.type === 'color' ? 'input' : 'change', () => {
    set(control.dataset.preference, control.type === 'checkbox' ? control.checked : control.type === 'range' ? Number(control.value) : control.value);
  });
  menu.addEventListener('click', event => {
    const board = event.target.closest('button[data-board-theme]'), pieces = event.target.closest('button[data-piece-set]');
    if (board) { preferences.customColors = false; set(`board${preferences.dimension}`, board.dataset.boardTheme); }
    if (pieces) set(`piece${preferences.dimension}`, pieces.dataset.pieceSet);
  });
  for (const grid of [$('board-themes'), $('piece-sets')]) grid.addEventListener('keydown', event => {
    const items = [...grid.children], index = items.indexOf(event.target.closest('button'));
    if (index < 0) return;
    const offset = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[event.key];
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : offset ? (index + offset + items.length) % items.length : null;
    if (next !== null) { event.preventDefault(); items[next].focus(); items[next].click(); }
  });
  $('theme-image-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const url = imageUrl(image.value.trim());
      image.value = url; imageError.hidden = true; image.removeAttribute('aria-invalid');
      set('image', url);
    } catch {
      imageError.textContent = 'Use an HTTPS image URL of up to 1,000 characters, or leave empty.';
      imageError.hidden = false; image.setAttribute('aria-invalid', 'true'); image.focus();
    }
  });
  $('flip-theme-preview').addEventListener('click', () => { previewFlipped = !previewFlipped; preview(); });
  $('reset-board-settings').addEventListener('click', () => {
    for (const key of ['boardOpacity', 'brightness', 'contrast', 'hue']) preferences[key] = defaults[key];
    save();
  });
  $('reset-display-settings').addEventListener('click', () => {
    preferences = { ...defaults }; image.value = ''; imageError.hidden = true; image.removeAttribute('aria-invalid'); save();
  });
  $('show-cookie-settings').addEventListener('click', () => {
    close(); $('cookie-notice').hidden = false; $('allow-preference-cookies').focus();
  });
  for (const [id, choice] of [['allow-preference-cookies', 'allowed'], ['decline-preference-cookies', 'declined']]) {
    $(id).addEventListener('click', () => {
      const saved = store.choose(choice, preferences);
      lastCookie = document.cookie; status(saved);
      if (saved || store.consent() === 'declined') $('cookie-notice').hidden = true;
      else $('cookie-save-error').hidden = false;
    });
  }
  deviceTheme.addEventListener('change', () => { if (preferences.mode === 'system') apply(); });
  function sync() {
    if (document.cookie === lastCookie) return;
    lastCookie = document.cookie;
    preferences = store.read(); image.value = preferences.image; imageError.hidden = true; image.removeAttribute('aria-invalid');
    $('cookie-notice').hidden = Boolean(store.consent()); apply(); status(true);
  }
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  image.value = preferences.image;
  $('cookie-notice').hidden = Boolean(store.consent());
  apply(); preview(); status(Boolean(store.consent() === 'allowed'));
  return { set };
}
