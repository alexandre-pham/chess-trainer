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
- **Stockfish**: checks your moves once theory ends, and analyses your games.
- **Coach**: explains mistakes in plain language, using a model that runs in the
  browser (WebGPU) or any OpenAI-compatible server such as Ollama. Facts about the
  position and Stockfish lines are given to the model so it does not invent moves.
- **Spaced repetition**: every position you must find is a card; missed positions
  come back sooner.
- **Today**: a daily plan (warm-up, reviews, new lines, mistakes, plans, your games).
- **Game review**: your recent Lichess games, annotated, with playable engine lines.
- **Squares**: coordinate exercises on real positions, with speed rounds.
- **Progress**: time per day and activity, calendar, streaks, accuracy per opening.
- **Sync**: progress saved in a secret GitHub gist, shared across browsers.

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
js/settings.js     Settings page: Lichess sign-in, statistics, coach, backup
js/sync.js         merging progress, GitHub gist sync
js/explorer.js     Lichess Opening Explorer client
js/coach.js        coach: in-browser model or server, prompts, follow-up questions
js/trainer.js      training board: game state, judging moves, drawing, navigation
js/engine.js       Stockfish in a background worker
js/squares.js      Squares page
js/daily.js        Today's plan and the check of your games
js/review.js       game review and playable lines
js/progress.js     time tracking, calendar, Progress page
data/openings.json opening lines and an index of positions
vendor/            chess.js and Stockfish
pieces/            piece images
```

Each module imports what it uses from the others. Code that binds events or
renders at start-up lives in each module's `init()`, which `main.js` calls in order.

## Credits and licences

- Stockfish (stockfish.js 10 by Niklas Fiekas): GPL v3, see `vendor/stockfish-COPYING.txt`.
  Because it includes Stockfish, this project is released under the GPL v3 (`LICENSE`).
- chess.js 0.10.3 by Jeff Hlywa: BSD 2-Clause, see `vendor/chess.js-LICENSE.txt`.
- Opening names and lines: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), CC0.
- Pieces: cburnett, CC BY-SA 3.0.
- Move statistics: Lichess Opening Explorer. In-browser models: WebLLM (MLC).
