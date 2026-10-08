import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaults, boards2d, boards3d, pieces2d, pieces3d, preferenceCookie, consentCookie,
  legacyStorageKey, createPreferenceStore, normalizePreferences, readCookie, pieceUrl,
} from '../src/display-preferences.js';
import { boardHtml } from '../src/board.js';

function cookieJar() {
  const cookies = new Map(), writes = [];
  return {
    writes,
    get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; '); },
    set cookie(value) {
      writes.push(value);
      const [pair] = value.split(';'), split = pair.indexOf('=');
      const key = pair.slice(0, split);
      if (value.includes('Max-Age=0;')) cookies.delete(key);
      else cookies.set(key, pair.slice(split + 1));
    },
  };
}

test('display preferences are not written until saving is allowed, then survive a new visit', () => {
  const jar = cookieJar(), store = createPreferenceStore(jar);
  const preferences = { ...defaults, dimension: '3d', board3d: 'Jade', piece3d: 'Glass', hue: 72, coordinates: false };
  assert.equal(store.save(preferences), false);
  assert.equal(jar.writes.length, 0);
  assert.equal(store.choose('allowed', preferences), true);
  assert.equal(readCookie(jar.cookie, consentCookie), 'allowed');
  assert.deepEqual(createPreferenceStore(jar).read(), preferences);
  assert.ok(jar.writes.every(value => value.includes('Path=/; Max-Age=31536000; SameSite=Lax; Secure')));
});

test('declining or revoking persistence removes the preference cookie and keeps only the choice', () => {
  const jar = cookieJar(), store = createPreferenceStore(jar);
  store.choose('allowed', { ...defaults, piece2d: 'merida' });
  assert.ok(readCookie(jar.cookie, preferenceCookie));
  assert.equal(store.choose('declined', defaults), true);
  assert.equal(readCookie(jar.cookie, preferenceCookie), null);
  assert.equal(readCookie(jar.cookie, consentCookie), 'declined');
  assert.equal(store.save({ ...defaults, board2d: 'purple' }), false);
  assert.deepEqual(createPreferenceStore(jar).read(), defaults);
});

test('existing local preferences migrate only after consent and are then removed from local storage', () => {
  const jar = cookieJar(), removed = [];
  const legacy = { getItem: () => JSON.stringify({ mode: 'light', picture: true, opacity: 60 }), removeItem: key => removed.push(key) };
  const store = createPreferenceStore(jar, legacy);
  const preferences = store.read();
  assert.equal(preferences.mode, 'light'); assert.equal(preferences.opacity, 60);
  assert.equal(jar.writes.length, 0); assert.equal(removed.length, 0);
  store.choose('allowed', preferences);
  assert.deepEqual(removed, [legacyStorageKey]);
  assert.equal(createPreferenceStore(jar).read().mode, 'light');
});

test('corrupt cookies and invalid catalog IDs or image protocols cannot inject CSS or break startup', () => {
  const jar = cookieJar();
  jar.cookie = `${consentCookie}=allowed`;
  jar.cookie = `${preferenceCookie}=%invalid`;
  assert.deepEqual(createPreferenceStore(jar).read(), defaults);
  const normalized = normalizePreferences({
    mode: 'other', dimension: '4d', board2d: 'x);url(https://bad.test)', piece3d: 'bad',
    image: 'javascript:alert(1)', lightSquare: 'red; color:blue', brightness: Infinity,
    contrast: -1, roundness: 300, hue: 500, coordinates: 'false',
  });
  assert.equal(normalized.board2d, 'brown'); assert.equal(normalized.piece3d, 'Basic');
  assert.equal(normalized.image, ''); assert.equal(normalized.lightSquare, defaults.lightSquare);
  assert.equal(normalized.contrast, 40); assert.equal(normalized.roundness, 15); assert.equal(normalized.hue, 360);
  assert.equal(normalized.coordinates, true);
});

test('blocked cookies report failed persistence while valid display preferences remain usable', () => {
  const blocked = { get cookie() { return ''; }, set cookie(value) {} };
  const store = createPreferenceStore(blocked);
  assert.equal(store.choose('allowed', defaults), false);
  assert.deepEqual(store.read(), defaults);
});

test('asset URLs support raster piece sets and the orientation of 3D bishops and knights', () => {
  const monarchy = pieces2d.find(x => x.id === 'monarchy');
  assert.ok(pieceUrl(monarchy, 'wN').endsWith('/monarchy/wN.webp'));
  const basic = pieces3d.find(x => x.id === 'Basic');
  assert.ok(pieceUrl(basic, 'bN', '3d').endsWith('/Black-Knight-Flipped.webp'));
  assert.ok(pieceUrl(basic, 'bN', '3d', true).endsWith('/Black-Knight.webp'));
  assert.ok(pieceUrl(basic, 'wB', '3d', true).endsWith('/White-Bishop-Flipped.webp'));
  const staunton = pieces3d.find(x => x.id === 'Staunton');
  assert.ok(pieceUrl(staunton, 'wN', '3d', false, true).endsWith('/White-Knight-Preview.webp'));
  assert.ok(pieceUrl(staunton, 'wN', '3d', true).endsWith('/White-Knight.webp'));
  assert.equal(pieceUrl(pieces2d[0], 'wN'), './pieces/wN.svg');
});

test('both dimensions expose the complete selectable Lichess catalogs with unique IDs', () => {
  assert.deepEqual([boards2d.length, boards3d.length, pieces2d.length, pieces3d.length], [25, 19, 42, 11]);
  for (const catalog of [boards2d, boards3d, pieces2d, pieces3d]) assert.equal(new Set(catalog.map(x => x.id)).size, catalog.length);
});

test('board rendering preserves positions, coordinates and highlights when the orientation changes', () => {
  const squares = Array(64).fill(null); squares[0] = 'wR'; squares[63] = 'bR';
  const position = { squares, last: { from: 0, to: 8 } };
  const normal = boardHtml(position), flipped = boardHtml(position, true);
  assert.equal((normal.match(/class="square/g) ?? []).length, 64);
  assert.ok(normal.indexOf('data-piece="bR"') < normal.indexOf('data-piece="wR"'));
  assert.ok(flipped.indexOf('data-piece="wR"') < flipped.indexOf('data-piece="bR"'));
  assert.ok(flipped.includes('class="board flipped"'));
  assert.equal((normal.match(/last"/g) ?? []).length, 2);
  assert.equal((normal.match(/coordinate rank/g) ?? []).length, 8);
  assert.equal((normal.match(/coordinate file/g) ?? []).length, 8);
});
