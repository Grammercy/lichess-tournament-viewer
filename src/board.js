export function boardHtml(pos, flipped = false) {
  if (pos?.pending) return '<div class="position-error">Loading position…</div>';
  if (!pos) return '<div class="position-error">Position unavailable</div>';
  let html = `<div class="board${flipped ? ' flipped' : ''}" aria-hidden="true">`;
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const rank = flipped ? row : 7 - row, file = flipped ? 7 - col : col, index = rank * 8 + file;
    const dark = (rank + file) % 2 === 0;
    const last = pos.last && (pos.last.from === index || pos.last.to === index);
    const piece = pos.squares[index];
    html += `<span class="square${dark ? ' dark' : ''}${last ? ' last' : ''}" style="--row:${row}">${piece ? `<span class="piece" data-piece="${piece}" style="background-image:var(--piece-${piece})"></span>` : ''}${col === 0 ? `<span class="coordinate rank">${rank + 1}</span>` : ''}${row === 7 ? `<span class="coordinate file">${'abcdefgh'[file]}</span>` : ''}</span>`;
  }
  return html + '</div>';
}
