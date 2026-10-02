# Lichess tournament viewer

A minimal Lichess-style board wall for Arena and Swiss tournaments. Paste a tournament link or ID to load every game, including completed games, into one grid. There is no game limit or pagination. Boards outside the viewport render when approached to keep large tournaments responsive.

Active positions refresh every 15 seconds. Arena pairings are discovered every 30 seconds; Swiss pairings are discovered as rounds and ongoing-game counts change, with a periodic full check. Lichess applies its three-move spectator delay. Clocks show the time recorded at the last available move rather than an invented live countdown. Requests are sequential, respect rate limits, and pause while the tab is hidden.

The viewer starts with a small tournament icon and a prompt to paste a link. Clicking the prompt focuses the tournament input. Filters, player search, board size, board flipping, an enlarged game view, and light/dark appearance are available after loading. Tournament links can also be opened with `?tournament=ID` or `?swiss=ID`.

## Run locally

Requires Node.js 22 or newer.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4173`. The local server watches source files; reload the browser after edits.

```sh
npm run build
npm test
npm run validate
```

The build produces a Cloudflare-compatible ESM Worker at `dist/server/index.js`. Assets are bundled into the Worker. The API proxy permits only the public Lichess tournament and game-export endpoints used by the viewer, and no account access is required.

## Sources and licensing

- Data: [Lichess API](https://lichess.org/api).
- Rules and notation: [chessops](https://github.com/niklasf/chessops), GPL-3.0-or-later.
- Chess pieces: Colin M. L. Burnett’s Cburnett set, from [Lichess](https://github.com/lichess-org/lila/tree/master/public/piece/cburnett), used under GPL-3.0-or-later.
- This project is distributed under GPL-3.0-or-later. See `LICENSE`.

This is an independent tournament viewer and is not an official Lichess product.
