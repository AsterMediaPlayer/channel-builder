// The spec's worked examples and acceptance checks, run against assets/channel-line.js.
// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { build, split, defaults } = createRequire(import.meta.url)('../assets/channel-line.js');

const examples = [
  ['1. nothing changed', {}, 'aster:channel'],
  ['2. a show playlist', { number: '7', mode: 'shuffle', reshuffle: 'week', logo: true },
    'aster:channel, aster:number=7, aster:mode=shuffle, aster:reshuffle=week, aster:logo=on'],
  ['3. a genre channel', { number: '4', mode: 'shuffle', genres: ['Animation'], type: 'movies', ratings: ['G', 'PG'], channelName: 'Family Movies' },
    'aster:channel, aster:number=4, aster:mode=shuffle, aster:genre=Animation, aster:type=movies, aster:rating=G, aster:rating=PG, aster:channel-name=Family Movies'],
  ['4. a network channel', { mode: 'blocks', blocksLow: '3', blocksHigh: '6', networks: ['NBC'], yearFrom: '1990', yearTo: '1999', weights: [{ show: 'Friends', weight: '2' }], shortest: '20' },
    'aster:channel, aster:mode=blocks, aster:blocks=3-6, aster:network=NBC, aster:years=1990-1999, aster:weight=Friends:2, aster:min-length=20'],
  ['5. words, a bug and a name with commas', { number: '2', bug: true, bugLocation: 'top-left', bugSize: 150, bugHide: '30', channelName: 'Laugh, Cry, Repeat', group: 'Anime Night', words: 'Twelve episodes of trying very hard to be bad.' },
    'Twelve episodes of trying very hard to be bad.\n\naster:channel, aster:number=2, aster:bug=on, aster:bug-location=top-left, aster:bug-size=150%, aster:bug-hide=30, aster:channel-name=Laugh, Cry, Repeat, aster:group=Anime Night'],
];

for (const [name, state, expected] of examples) {
  test(`worked example ${name}`, () => {
    const r = build(state);
    assert.equal(r.output, expected);
    assert.deepEqual(r.errors, {});
  });
  test(`worked example ${name}: Aster's split gives back exactly the entries`, () => {
    const r = build(state);
    assert.deepEqual(split(r.line), r.entries);
  });
}

test('every field at its default writes nothing', () => {
  assert.equal(build(defaults()).output, 'aster:channel');
  assert.equal(build({ mode: 'blocks', blocksLow: '2', blocksHigh: '4', reshuffle: 'day', seed: '0', bug: true, bugLocation: 'bottom-right', bugSize: 100, bugOpacity: 45, bugHide: '', type: 'all', weights: [{ show: 'Friends', weight: '1' }] }).output,
    'aster:channel, aster:mode=blocks, aster:bug=on');
});

test('fields hidden by the mode write nothing, even if filled', () => {
  const filled = { blocksLow: '3', blocksHigh: '6', reshuffle: 'week', seed: '5', weights: [{ show: 'Friends', weight: '3' }] };
  assert.equal(build({ ...filled, mode: 'sequential' }).output, 'aster:channel, aster:mode=sequential');
  assert.equal(build({ ...filled, mode: 'airdate' }).output, 'aster:channel, aster:mode=airdate');
  assert.equal(build({ ...filled, mode: 'shuffle' }).output, 'aster:channel, aster:mode=shuffle, aster:reshuffle=week, aster:seed=5');
  assert.equal(build({ ...filled, mode: 'rotation' }).output, 'aster:channel, aster:reshuffle=week, aster:seed=5, aster:weight=Friends:3');
});

test('bug settings write nothing while the bug is off', () => {
  assert.equal(build({ bug: false, bugLocation: 'top-left', bugSize: 200, bugOpacity: 80, bugHide: '30' }).output, 'aster:channel');
});

test('opacity comes after hide-after, as the spec orders them', () => {
  assert.equal(build({ bug: true, bugHide: '60', bugOpacity: 70 }).output, 'aster:channel, aster:bug=on, aster:bug-hide=60, aster:bug-opacity=70%');
});

test('aster: in any value is refused, and only that field stops writing', () => {
  const r = build({ number: '3', channelName: 'News, aster:mode=blocks', group: 'Kids' });
  assert.equal(r.errors.channelName, "Can't contain aster:");
  assert.equal(r.output, 'aster:channel, aster:number=3, aster:group=Kids');
  assert.equal(build({ genres: ['Comedy', 'ASTER:x'] }).errors.genres, "Can't contain aster:");
  assert.equal(build({ genres: ['Comedy', 'ASTER:x'] }).output, 'aster:channel');
  assert.ok(build({ words: 'see aster:logo' }).errors.words);
  assert.equal(build({ words: 'see aster:logo' }).output, 'aster:channel');
});

test('text: line breaks become spaces, spaces are trimmed', () => {
  assert.equal(build({ channelName: '  Rock\nBlock  ' }).output, 'aster:channel, aster:channel-name=Rock Block');
});

test('tag lists: trimmed, empties dropped, repeats dropped ignoring case', () => {
  assert.equal(build({ genres: [' Comedy ', '', 'comedy', 'Horror'] }).output, 'aster:channel, aster:genre=Comedy, aster:genre=Horror');
});

test('numbers: whole and in range, empty means default', () => {
  assert.ok(build({ number: '0' }).errors.number);
  assert.ok(build({ number: '2.5' }).errors.number);
  assert.ok(build({ shortest: '601' }).errors.shortest);
  assert.ok(build({ yearFrom: '1879' }).errors.yearFrom);
  assert.equal(build({ number: '0', group: 'A' }).output, 'aster:channel, aster:group=A');
});

test('ranges: one box gives a single value; low above high is refused', () => {
  assert.equal(build({ yearFrom: '1994' }).output, 'aster:channel, aster:years=1994');
  assert.equal(build({ yearTo: '1994' }).output, 'aster:channel, aster:years=1994');
  assert.equal(build({ yearFrom: '1994', yearTo: '1994' }).output, 'aster:channel, aster:years=1994');
  assert.ok(build({ yearFrom: '1999', yearTo: '1990' }).errors.yearTo);
  assert.equal(build({ mode: 'blocks', blocksLow: '3' }).output, 'aster:channel, aster:mode=blocks, aster:blocks=3');
  assert.ok(build({ mode: 'blocks', blocksLow: '6', blocksHigh: '3' }).errors.blocksHigh);
});

test('Longest shorter than Shortest is refused; Shortest still writes', () => {
  const r = build({ shortest: '30', longest: '20' });
  assert.ok(r.errors.longest);
  assert.equal(r.output, 'aster:channel, aster:min-length=30');
});

test('show weights: 1 to 5, no trailing colon', () => {
  assert.ok(build({ weights: [{ show: 'Friends', weight: '6' }] }).errors.weight0);
  assert.ok(build({ weights: [{ show: 'Friends:', weight: '2' }] }).errors.weight0);
  assert.equal(build({ weights: [{ show: 'Star Trek: TNG', weight: '2' }] }).output, 'aster:channel, aster:weight=Star Trek: TNG:2');
});

test('hints: narrowing fields alone, and source fields', () => {
  assert.ok(build({ ratings: ['PG'] }).hints.narrow);
  assert.ok(!build({ ratings: ['PG'], genres: ['Comedy'] }).hints.narrow);
  assert.ok(build({ genres: ['Comedy'] }).hints.sources);
});
