# Uma Guess Who Lobby Template

Real-time Guess Who-style game with lobby code joining, random first turn, and configurable roles for multi-player formats.

## Sources

- Guess Who base mechanics: https://en.wikipedia.org/wiki/Guess_Who%3F
- Character list: https://umamusu.wiki/List_of_Characters
- Character images: extracted from each character page on umamusu.wiki

## What this version supports

- Lobby creation and join by code
- Random starting guesser when game begins
- Configurable:
  - number of holders (players with secret characters)
  - total question limit
  - team count
  - single-target vs same-question-for-all-holders mode
  - holder character assignment mode
- Full-board character selection for guessers
- Holder wiki reference panel while answering
- Character image zoom modal
- Character roster sync from umamusu.wiki on server launch (with fallback)

## Install and run

Important: do not open `index.html` directly with `file://`. Start the server and use `http://localhost:3000`.

1. Install dependencies:

```bash
npm install
```

2. Start server:

```bash
npm start
```

3. Open in browser:

- `http://localhost:3000`

## Character sync behavior

- On server launch, the app attempts to refresh `characters.js` from `https://umamusu.wiki/List_of_Characters`.
- If sync fails (offline, timeout, site unavailable), it keeps using the bundled local list.
- Optional env vars:
  - `SKIP_CHARACTER_SYNC=1` disables startup sync.
  - `CHARACTER_SYNC_TIMEOUT_MS=12000` controls fetch timeout.

## Config examples

- 2 guessers working together against 1 holder:
  - 3 players total
  - holders = 1
  - team count = 2
  - put both guessers on the same team

- 1 guesser vs 2 holders:
  - 3 players total
  - holders = 2
  - set `same question applies to all unsolved holders` ON for shared-question mode
  - set it OFF for separate target-by-target questions