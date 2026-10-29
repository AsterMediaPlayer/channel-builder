# Plex Channel Builder

A one-page form that writes the line which turns a **Plex video playlist into a TV-style channel** in
[Aster Media Player](https://astermediaplayer.com). Fill in the form, copy the line, and paste it into the playlist's
description (Summary) in Plex.

It runs entirely in the browser. There is no server behind it, and nothing is loaded from anywhere else.

## Sign in with Plex (optional, read-only)

Signing in fills every name box with suggestions from your own library (genres, networks and studios, collections,
libraries, ratings, Home users, and shows for weights), and can load a playlist's current settings into the form.
Typing everything by hand works without it.

- **Plex's PIN sign-in** (the same link-code flow apps use): a pop-up to plex.tv, then the page picks up the token.
- **The token stays in the tab** (`sessionStorage`): it ends when the tab closes or on **Sign out**, and goes only to
  plex.tv and your own servers. There is no server here to send it to. It appears under plex.tv ▸ Authorized
  Devices as "Aster Channel Builder", where it can be removed any time.
- **The page may talk only to `https://plex.tv` and `https://*.plex.direct`** (its content-security policy), and
  only after you choose to sign in. Servers are reached over their secure plex.direct addresses; a server with
  Secure connections set to Disabled can't be reached from an https page.
- **Read-only.** Nothing here changes anything in Plex.
- Plex tokens can't be limited to reading, so the page's own code is what keeps them safe: no outside scripts, and
  every name from Plex is shown as plain text, never as HTML. Changes to this repository should go through review.

## The line

`aster:channel`, then one `aster:key=value` entry per setting that differs from Aster's default, joined by `, `:

```
aster:channel, aster:number=7, aster:mode=shuffle, aster:reshuffle=week, aster:logo=on
```

Aster splits the line only at a comma followed by `aster:`, so values may contain commas
(`aster:channel-name=Laugh, Cry, Repeat`) but never `aster:` or a line break. Description words, if any, go above it
after a blank line; Aster ignores everything before the first `aster:`.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `assets/channel-line.js` | Builds the line from the form's choices. Pure, no DOM, so it's tested directly |
| `assets/app.js` | The form: tag lists, show weights, live preview, Copy and Reset |
| `assets/plex.js` | The optional Plex sign-in and library reading (read-only) |
| `assets/plex-ui.js` | The "Your Plex library" section of the page |
| `assets/site.css`, `assets/fonts/` | Aster's look; fonts are SIL OFL (texts beside them) |
| `tests/channel-line.test.mjs` | The spec's five worked examples (character for character), its acceptance rules, and reading a description back |

Run the tests with `node --test "tests/*.test.mjs"`. There is no build step: GitHub Pages serves the files as they are.

## Not in this version

Breaks and commercials (Aster can't play them on Plex yet), and writing the line into a playlist for you (planned
next: a "Save to playlist" button).
