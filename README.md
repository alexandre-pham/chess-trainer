# Chess Trainer

Learn chess openings move by move. The trainer plays the other side using the
moves real players choose, tells you when you leave the main lines and why, and
brings back the positions you miss until you know them.

Live: https://alexandre-pham.github.io/chess-trainer/

## Features

- **Openings**: 3,865 named lines from the Lichess opening book, searchable by
  name, ECO code or moves. Train as White or Black, a whole opening or one variation.
- **Move statistics**: with a Lichess connection, the opponent plays the moves
  that real players choose (Lichess players by rating, or masters).
- **Stockfish**: checks your moves once theory ends, and analyses your games. An optional
  evaluation bar and the top 3 engine lines (hidden on your turn until you ask).
- **Explanations**: for each mistake, facts computed from the position and Stockfish's
  lines (material, the opponent's reply, loose pieces, pawn structure), and the
  human-written explanation of the opening from Wikibooks.
- **Spaced repetition**: every position you must find is a card; missed positions
  come back sooner.
- **Today**: a daily plan (warm-up, reviews, new lines, mistakes, plans, your games).
- **Game review**: your recent Lichess games, annotated, with playable engine lines.
- **Squares**: coordinate exercises on real positions, with speed rounds, and
  playing famous games or great players' games from their written moves.
- **Progress**: time per day and activity, calendar, streaks, accuracy per opening.
- **Accounts**: sign in with an email and a password (Firebase) to keep your progress on all
  your devices. Without an account, progress stays in the browser.

## Run it locally

The app uses JavaScript modules, which browsers only load from a web address:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

No build step and no dependencies to install.

## Code layout

```
index.html         page structure
css/app.css        styles
js/main.js         start-up and navigation between pages
js/util.js         small helpers, browser storage
js/data.js         loads the opening book and piece images
js/book.js         opening families, selection and settings, book moves
js/srs.js          spaced repetition cards and answer log
js/setup.js        Openings page
js/settings.js     Settings page: Lichess sign-in, statistics, backup
js/sync.js         merging progress, accounts and sync (Firebase Auth + Firestore)
js/firebase-config.js  the Firebase project's web config (null = no accounts)
js/explorer.js     Lichess Opening Explorer client
js/analysis.js     plain-language facts about a move (no AI)
js/wikibooks.js    opening explanations from Wikibooks
js/explain.js      explanations: position facts and Wikibooks text
js/trainer.js      training board: game state, judging moves, drawing, navigation, restoring after a reload
js/engine.js       Stockfish in a background worker
js/squares.js      Squares page
js/daily.js        Today's plan and the check of your games
js/review.js       game review and playable lines
js/progress.js     time tracking, calendar, Progress page
data/openings.json opening lines and an index of positions
data/games.json    famous games and a selection of great players' games
vendor/            chess.js and Stockfish
pieces/            piece images
```

Each module imports what it uses from the others. Code that binds events or
renders at start-up lives in each module's `init()`, which `main.js` calls in order.

## Credits and licences

- Stockfish 19 lite (stockfish.js by Nathan Rugg): GPL v3, see `vendor/stockfish-19-COPYING.txt`.
  Fallback for browsers without WebAssembly: stockfish.js 10 by Niklas Fiekas, GPL v3, see `vendor/stockfish-COPYING.txt`.
  Because it includes Stockfish, this project is released under the GPL v3 (`LICENSE`).
- chess.js 0.10.3 by Jeff Hlywa: BSD 2-Clause, see `vendor/chess.js-LICENSE.txt`.
- Opening names and lines: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), CC0.
- Pieces: cburnett, CC BY-SA 3.0.
- Famous and great players' games (`data/games.json`): game scores from the pgnmentor.com
  collections, as packaged in [Dragjon/chessdatabase](https://github.com/Dragjon/chessdatabase) (MIT);
  Deep Blue vs Kasparov 1997 from the python-chess test data.
- Opening explanations: Wikibooks, Chess Opening Theory (CC BY-SA), fetched live and credited with a link.
- Move statistics: Lichess Opening Explorer.

## Hosting and accounts (Firebase)

The app is static files; Firebase hosts them and provides sign-in and storage (free Spark plan).

1. In the [Firebase console](https://console.firebase.google.com), create a project.
2. **Authentication** > Get started > **Email/Password** > enable.
3. **Firestore Database** > Create database (production mode).
4. **Project settings** > Your apps > add a **Web app**, copy its config into `js/firebase-config.js`.
5. Deploy the site and the security rules:

   ```
   npm install -g firebase-tools
   firebase login
   firebase use --add          # pick the project
   firebase deploy             # hosting + Firestore rules
   ```

Each person's progress is stored under `users/{their id}` and `firestore.rules` lets only them
read or write it. `firebase.json` tells browsers to check for new files on every visit, so a
new version is never mixed with old cached files.

