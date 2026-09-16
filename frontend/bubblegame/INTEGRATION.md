# Bubble game result upload

`index.html` loads the built game bundle and `result-upload.js`. The game bundle dispatches
`bubblegame:finished` after rendering the result overlay, with this event detail:

```js
{
  mode: 'single' | 'double',
  players: [{ score, totalRounds, ...otherPlayerStats }]
}
```

`result-upload.js` records the start time when a start button is clicked, reads the
students from `sessionStorage`, and sends one `POST /api/sessions` per student.
Double-player requests share one `pairId`. The five required EFT statistics are
built by `session-payload.mjs`; `node --test frontend/bubblegame/*.test.mjs` checks
the payload and the independent double-player upload/retry behavior.

The original `bubblegame/src` directory is currently absent from this workspace.
The finish event was added to `assets/index-game-sessions.js`, a copy of the built
bundle. If the Vite source is restored, dispatch the same event in its result
callback and include `result-upload.js` in the new build before replacing these
files. A fresh Vite build will otherwise remove this integration.
