import { boards2d, boards3d, pieces2d, pieces3d } from './lichess-themes.js';

export { boards2d, boards3d, pieces2d, pieces3d };
export const preferenceCookie = 'tv_display';
export const consentCookie = 'tv_cookie_choice';
export const legacyStorageKey = 'tournament-viewer.theme';
export const defaultImage = 'https://lichess1.org/assets/images/background/landscape.jpg';
export const pieceCodes = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
export const defaults = Object.freeze({
  mode: 'dark', picture: false, image: '', opacity: 100, roundness: 3,
  dimension: '2d', board2d: 'brown', board3d: 'Woodi', piece2d: 'cburnett', piece3d: 'Basic',
  boardOpacity: 100, brightness: 100, contrast: 100, hue: 0,
  customColors: false, lightSquare: '#f0d9b5', darkSquare: '#b58863',
  coordinates: true, highlights: true, density: 'compact',
});

export function imageUrl(value) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 1000) throw new Error('Image URL is too long');
  const url = new URL(value.startsWith('//') ? `https:${value}` : value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid image URL');
  if (url.href.length > 1000) throw new Error('Image URL is too long');
  return url.href;
}

export function normalizePreferences(saved) {
  const result = { ...defaults };
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return result;
  for (const key of ['picture', 'customColors', 'coordinates', 'highlights']) {
    if (typeof saved[key] === 'boolean') result[key] = saved[key];
  }
  for (const [key, values] of Object.entries({
    mode: ['system', 'light', 'dark'], dimension: ['2d', '3d'], density: ['compact', 'comfortable'],
    board2d: boards2d.map(x => x.id), board3d: boards3d.map(x => x.id),
    piece2d: pieces2d.map(x => x.id), piece3d: pieces3d.map(x => x.id),
  })) if (values.includes(saved[key])) result[key] = saved[key];
  for (const [key, min, max] of [
    ['opacity', 5, 100], ['roundness', 0, 15], ['boardOpacity', 0, 100],
    ['brightness', 20, 140], ['contrast', 40, 200], ['hue', 0, 360],
  ]) if (Number.isFinite(saved[key])) result[key] = Math.round(Math.max(min, Math.min(max, saved[key])));
  for (const key of ['lightSquare', 'darkSquare']) {
    if (typeof saved[key] === 'string' && /^#[a-f\d]{6}$/i.test(saved[key])) result[key] = saved[key];
  }
  try { result.image = imageUrl(saved.image ?? ''); } catch {}
  return result;
}

export function readCookie(cookie, name) {
  const entry = cookie.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  if (!entry) return null;
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return null; }
}

export function createPreferenceStore(cookieDocument, legacyStorage, secure = true) {
  function consent() {
    try {
      const value = readCookie(cookieDocument.cookie, consentCookie);
      return ['allowed', 'declined'].includes(value) ? value : null;
    } catch { return null; }
  }
  function write(name, value, maxAge = 31536000) {
    const encoded = encodeURIComponent(value);
    if (name.length + encoded.length > 3800) return false;
    try {
      cookieDocument.cookie = `${name}=${encoded}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`;
      return readCookie(cookieDocument.cookie, name) === (maxAge ? value : null);
    } catch { return false; }
  }
  function clearLegacy() { try { legacyStorage?.removeItem(legacyStorageKey); } catch {} }
  function read() {
    try {
      if (consent() === 'allowed') return normalizePreferences(JSON.parse(readCookie(cookieDocument.cookie, preferenceCookie)));
      if (!consent()) return normalizePreferences(JSON.parse(legacyStorage?.getItem(legacyStorageKey) ?? 'null'));
    } catch {}
    return { ...defaults };
  }
  function save(preferences) {
    if (consent() !== 'allowed') return false;
    const saved = write(preferenceCookie, JSON.stringify(normalizePreferences(preferences)));
    if (saved) clearLegacy();
    return saved;
  }
  function choose(value, preferences) {
    if (!['allowed', 'declined'].includes(value)) throw new Error('Invalid cookie choice');
    if (!write(consentCookie, value)) return false;
    if (value === 'declined') {
      write(preferenceCookie, '', 0);
      clearLegacy();
      return true;
    }
    return save(preferences);
  }
  return { consent, read, save, choose };
}

export function boardTheme(preferences) {
  return (preferences.dimension === '3d' ? boards3d : boards2d).find(x => x.id === preferences[`board${preferences.dimension}`]);
}

export function pieceSet(preferences) {
  return (preferences.dimension === '3d' ? pieces3d : pieces2d).find(x => x.id === preferences[`piece${preferences.dimension}`]);
}

export function pieceUrl(set, code, dimension = '2d', flipped = false, preview = false) {
  if (!pieceCodes.includes(code)) throw new Error('Invalid piece');
  if (dimension === '2d') {
    if (set.id === 'cburnett') return `./pieces/${code}.svg`;
    return `https://lichess1.org/assets/piece/${set.id}/${code}.${set.ext}`;
  }
  const role = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' }[code[1]];
  const color = code[0] === 'w' ? 'White' : 'Black';
  const suffix = preview && set.id === 'Staunton' && code === 'wN' ? '-Preview'
    : set.flips && ['B', 'N'].includes(code[1]) && (flipped ? code[0] === 'w' : code[0] === 'b') ? '-Flipped' : '';
  return `https://lichess1.org/assets/images/staunton/piece/${set.id}/${color}-${role}${suffix}.webp`;
}
