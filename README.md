# Lichess tournament viewer

A minimal Lichess-style board wall for Arena and Swiss tournaments. Paste a tournament link or ID to load every game, including completed games, into one grid. There is no game limit or pagination. Boards outside the viewport render when approached to keep large tournaments responsive.

Open the viewer on [ChatGPT Sites](https://lichess-tournament-viewer.aralani.chatgpt.site). Each tournament opens on the Playing tab. Choose All games or Finished to view completed games.

A loading screen appears immediately after submitting a tournament and stays visible until the first game in the current filter arrives. If loading finishes without any matching games, the viewer shows the empty state.

After an Arena or Swiss tournament finishes, **Import to study** appears in the game summary. Choose a study name and visibility, sign in with Lichess, then choose **Import all games**. The import downloads every tournament game as PGN, regardless of the current game filter or player search, and preserves moves, tags, custom positions, variants, and clock comments. Each game becomes a chapter. Tournaments with more than Lichess's 64-chapter limit create numbered studies automatically. The import shows progress and links to each study. A partial import can retry the remaining games in the same study; a lost write response asks you to check the studies before starting another import.

Study imports use Lichess OAuth with PKCE and request only `study:write` permission. The pending sign-in and chosen tournament settings use session storage for the redirect. The access token stays in memory and requests go directly to Lichess; the viewer's server never receives the token. Display cookie preferences do not affect sign-in. Reloading the viewer requires signing in again for a new import. Viewing tournaments still requires no account.

Tournament details, full player rankings, and lightweight game discovery start concurrently. Games that arrive before the details are confirmed are buffered, then displayed immediately. Ongoing games subscribe to live updates as soon as they arrive, and their move histories and clocks load before finished-game histories. Finished histories load in background batches of up to 32 games, with pairing discovery taking priority between batches. Boards show "Loading position…" until their position arrives. The grid fills without waiting for the rankings; once those arrive, the cards reorder by tournament rank. Switching tournaments cancels the requests, and an Arena ID that resolves to a Swiss tournament restarts them together.

Games are ordered by the highest-placed tournament participant in each pairing: a game with #1 comes before a game whose best participant is #2. Arena and Swiss use the full tournament results stream to include ranks beyond the first standings page, and refresh those ranks with tournament information. This order applies to every game filter. When several games involve the same highest-placed participant, ongoing games come first, then newest games.

Active boards receive positions, clocks, and results through Lichess's public WebSocket, using the same `fen` and `finish` messages as Lichess's own mini-game boards. Moves render on the next animation frame, and live clocks count down between updates. When either clock reaches zero, the game leaves Playing and appears in Finished with "Result pending" until Lichess confirms the outcome. The game stays subscribed, and a live clock correction restores it to Playing. Unknown clocks keep games in Playing, and positive fractions display at least one second. Study imports and the tournament-end message still wait for confirmed results. Each connection watches up to 16 games, with additional connections for larger tournaments. Connections automatically reconnect and restore their subscriptions. They pause while the tab is hidden and resume when it becomes visible. On tab return or socket reconnection, the viewer refreshes tournament information and exports every game still awaiting a result, including games in an ended tournament. Ended tournaments also recheck those games every 30 seconds until their results are confirmed. A tab return during an existing request queues another catch-up, and rate limits delay retries.

Arena pairings and standings are discovered every 30 seconds; Swiss pairings are discovered as rounds and ongoing-game counts change, with a periodic full check. Game exports seed the initial boards and supply completed move histories. Those exports have Lichess's three-move API delay for ongoing games, but they never replace a newer streamed board. Only one game export runs at a time, and rate-limited requests wait before retrying.

The viewer starts with a small Homura illustration and a speech bubble prompting you to paste a link, centered in the empty view. The bubble and its text are rendered in HTML and CSS. Clicking the prompt focuses the tournament input. After a tournament finishes and its last active game ends, Homura returns in the Playing tab to announce the end and point to the Finished tab. Filters, player search, board size, board flipping, and an enlarged game view are available after loading. Tournament links can also be opened with `?tournament=ID` or `?swiss=ID`.

When a visible game leaves Playing after a result or clock expiry, its card shatters into angular fragments that spin outward and fade over 0.9 seconds. The fragments preserve the current board, pieces, and player details. The grid closes the gap after the animation. Filter changes remove cards immediately, and offscreen cards and reduced-motion preferences skip the effect. A live clock correction cancels the shatter and restores the card.

The header's Theme dropdown has Appearance, Board, and Pieces tabs with a live, flippable preview. Appearance follows [Lichess's options](https://github.com/lichess-org/lila/blob/master/ui/dasher/src/theme.ts): Device theme, Light, and Dark, with an optional background picture, image opacity, and interface roundness. Pictures use the Lichess landscape by default or a custom HTTPS image URL. The board and piece catalogs include all 25 selectable 2D boards, 19 3D boards, 42 2D piece sets, and 11 3D piece sets from Lichess. Board controls also offer custom square colors, opacity, brightness, contrast, hue, coordinates, move highlights, and board size. Changes apply immediately to existing boards and the enlarged game view.

A cookie notice offers “Save my preferences” or “Use without saving.” Display preferences are stored for one year in the `tv_display` cookie only after accepting; a separate `tv_cookie_choice` cookie remembers the choice. Cookies use `SameSite=Lax`, the root path, and `Secure` on HTTPS. Cookie settings in the dropdown lets visitors change their choice and delete saved preferences. Without saving, settings apply for the current visit. Previously saved local preferences migrate only after accepting. Saved preferences synchronize when another tab gains focus.

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

The build produces a Cloudflare-compatible ESM Worker at `dist/server/index.js`. Assets are bundled into the Worker. The API proxy permits only the public Lichess tournament and game-export endpoints used by the viewer. Live positions connect directly to Lichess's `/api/socket` endpoint. Viewing tournaments requires no account. Study imports authenticate directly with Lichess.

## Sources and licensing

- Data: [Lichess API](https://lichess.org/api).
- Rules and notation: [chessops](https://github.com/niklasf/chessops), GPL-3.0-or-later.
- Chess pieces: Colin M. L. Burnett’s Cburnett set, from [Lichess](https://github.com/lichess-org/lila/tree/master/public/piece/cburnett), used under GPL-3.0-or-later.
- Additional board textures and piece sets load from Lichess's asset CDN. Catalogs follow the official [board themes](https://github.com/lichess-org/lila/blob/master/modules/pref/src/main/Theme.scala) and [piece sets](https://github.com/lichess-org/lila/blob/master/modules/pref/src/main/PieceSet.scala), checked on October 5, 2026. Asset credits and individual licenses are listed in [Lichess's copying information](https://github.com/lichess-org/lila/blob/master/COPYING.md).
- Homura illustration: the user-supplied transparent reference, used without image generation. This third-party character artwork is excluded from the project's code license.
- This project is distributed under GPL-3.0-or-later. See `LICENSE`.

This is an independent tournament viewer and is not an official Lichess product.
