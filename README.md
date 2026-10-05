# Lichess tournament viewer

A minimal Lichess-style board wall for Arena and Swiss tournaments. Paste a tournament link or ID to load every game, including completed games, into one grid. There is no game limit or pagination. Boards outside the viewport render when approached to keep large tournaments responsive.

Open the viewer on [ChatGPT Sites](https://lichess-tournament-viewer.aralani.chatgpt.site). Each tournament opens on the Playing tab. Choose All games or Finished to view completed games.

A loading screen appears immediately after submitting a tournament and stays visible until the first game in the current filter arrives. If loading finishes without any matching games, the viewer shows the empty state.

Tournament details, full player rankings, and lightweight game discovery start concurrently. Games that arrive before the details are confirmed are buffered, then displayed immediately. Ongoing games subscribe to live updates as soon as they arrive, and their move histories and clocks load before finished-game histories. Finished histories load in background batches of up to 32 games, with pairing discovery taking priority between batches. Boards show "Loading position…" until their position arrives. The grid fills without waiting for the rankings; once those arrive, the cards reorder by tournament rank. Switching tournaments cancels the requests, and an Arena ID that resolves to a Swiss tournament restarts them together.

Games are ordered by the highest-placed tournament participant in each pairing: a game with #1 comes before a game whose best participant is #2. Arena and Swiss use the full tournament results stream to include ranks beyond the first standings page, and refresh those ranks with tournament information. This order applies to every game filter. When several games involve the same highest-placed participant, ongoing games come first, then newest games.

Active boards receive positions, clocks, and results through Lichess's public WebSocket, using the same `fen` and `finish` messages as Lichess's own mini-game boards. Moves render on the next animation frame, and live clocks count down between updates. Each connection watches up to 16 games, with additional connections for larger tournaments. Connections automatically reconnect and restore their subscriptions. They pause while the tab is hidden and resume when it becomes visible.

Arena pairings and standings are discovered every 30 seconds; Swiss pairings are discovered as rounds and ongoing-game counts change, with a periodic full check. Game exports seed the initial boards and supply completed move histories. Those exports have Lichess's three-move API delay for ongoing games, but they never replace a newer streamed board. Only one game export runs at a time, and rate-limited requests wait before retrying.

The viewer starts with a small Homura illustration and a speech bubble prompting you to paste a link, centered in the empty view. The bubble and its text are rendered in HTML and CSS. Clicking the prompt focuses the tournament input. Filters, player search, board size, board flipping, an enlarged game view, and light/dark appearance are available after loading. Tournament links can also be opened with `?tournament=ID` or `?swiss=ID`.

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

The build produces a Cloudflare-compatible ESM Worker at `dist/server/index.js`. Assets are bundled into the Worker. The API proxy permits only the public Lichess tournament and game-export endpoints used by the viewer. Live positions connect directly to Lichess's `/api/socket` endpoint. No account access is required.

## Sources and licensing

- Data: [Lichess API](https://lichess.org/api).
- Rules and notation: [chessops](https://github.com/niklasf/chessops), GPL-3.0-or-later.
- Chess pieces: Colin M. L. Burnett’s Cburnett set, from [Lichess](https://github.com/lichess-org/lila/tree/master/public/piece/cburnett), used under GPL-3.0-or-later.
- Homura illustration: the user-supplied transparent reference, used without image generation. This third-party character artwork is excluded from the project's code license.
- This project is distributed under GPL-3.0-or-later. See `LICENSE`.

This is an independent tournament viewer and is not an official Lichess product.
