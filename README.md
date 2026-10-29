# Plex Channel Builder

A one-page form that writes the line which turns a **Plex video playlist into a TV-style channel** in
[Aster Media Player](https://astermediaplayer.com). Fill in the form, copy the line, and paste it into the playlist's
description (Summary) in Plex.

It runs entirely in the browser: no server, no sign-in, no calls to Plex, and nothing loaded from anywhere else
(the page's content-security policy allows only its own files).

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
| `assets/site.css`, `assets/fonts/` | Aster's look; fonts are SIL OFL (texts beside them) |
| `tests/channel-line.test.mjs` | The spec's five worked examples (character for character) and its acceptance rules |

Run the tests with `node --test tests/`. There is no build step: GitHub Pages serves the files as they are.

## Not in this version

Breaks and commercials (Aster can't play them on Plex yet), talking to Plex (names are typed by hand), and reading
an existing description back into the form.
