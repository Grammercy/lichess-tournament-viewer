import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('public/pieces', { recursive: true });
await Promise.all(['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP'].map(async name => {
  const response = await fetch(`https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett/${name}.svg`);
  if (!response.ok) throw new Error(`Piece ${name}: ${response.status}`);
  await writeFile(`public/pieces/${name}.svg`, await response.text());
}));
console.log('Saved all 12 Lichess Cburnett pieces.');
