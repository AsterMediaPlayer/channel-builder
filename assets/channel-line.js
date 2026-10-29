/*
 * channel-line.js: turns the form's choices into the line Aster reads from a Plex playlist's description.
 *
 * The line is aster:channel followed by one aster:key=value entry per setting that differs from Aster's default,
 * joined by ", ". Aster splits it only at a comma followed (after spaces) by "aster:", so no value may contain
 * "aster:" and no value may hold a line break. Description words, when given, go above it after a blank line.
 *
 * Pure: no DOM. build(state) returns { output, line, entries, errors, hints }. A field with a problem writes
 * nothing; everything else still does. Works in the page (window.ChannelLine) and in Node (require).
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.ChannelLine = api;
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var MODES = ['rotation', 'blocks', 'shuffle', 'sequential', 'airdate'];
    var RESHUFFLE_MODES = ['rotation', 'blocks', 'shuffle'];
    var WEIGHT_MODES = ['rotation', 'blocks'];
    var CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    var TYPES = ['all', 'movies', 'shows'];
    var RESHUFFLES = ['day', 'week', 'month'];
    var NO_ASTER = "Can't contain aster:";

    // The state of an untouched form: every field empty or at Aster's default.
    function defaults() {
        return {
            number: '', channelName: '', group: '',
            genres: [], networks: [], collections: [], type: 'all', libraries: [],
            yearFrom: '', yearTo: '', ratings: [], shortest: '', longest: '',
            mode: 'rotation', blocksLow: '', blocksHigh: '', reshuffle: 'day', seed: '', weights: [],
            logo: false, bug: false, bugLocation: 'bottom-right', bugSize: 100, bugOpacity: 45, bugHide: '',
            users: [], words: ''
        };
    }

    // Text values: line breaks become spaces, then trim.
    function clean(text) {
        return String(text === undefined || text === null ? '' : text).replace(/[\r\n]+/g, ' ').trim();
    }

    function hasAster(text) {
        return /aster:/i.test(text);
    }

    // A tag list: trim each item, drop empty ones and repeats (ignoring case).
    function tidyList(items) {
        var seen = [];
        var out = [];
        (items || []).forEach(function (item) {
            var value = clean(item);
            if (value && seen.indexOf(value.toLowerCase()) < 0) {
                seen.push(value.toLowerCase());
                out.push(value);
            }
        });
        return out;
    }

    // A whole number in [min, max] (max may be null). '' means "use the default".
    // Returns { empty: true } | { value: n } | { error: message }.
    function wholeNumber(raw, min, max) {
        var text = clean(raw);
        if (text === '') {
            return { empty: true };
        }
        if (!/^\d+$/.test(text)) {
            return { error: max === null ? 'Use a whole number, ' + min + ' or more' : 'Use a whole number from ' + min + ' to ' + max };
        }
        var n = parseInt(text, 10);
        if (n < min || (max !== null && n > max)) {
            return { error: max === null ? 'Use a whole number, ' + min + ' or more' : 'Use a whole number from ' + min + ' to ' + max };
        }
        return { value: n };
    }

    // Two boxes making a range. One box filled gives a single value; low > high is refused.
    // Returns { empty } | { low, high } | { error, field }.
    function range(rawLow, rawHigh, min, max, lowName, highName) {
        var low = wholeNumber(rawLow, min, max);
        var high = wholeNumber(rawHigh, min, max);
        if (low.error) {
            return { error: low.error, field: lowName };
        }
        if (high.error) {
            return { error: high.error, field: highName };
        }
        if (low.empty && high.empty) {
            return { empty: true };
        }
        var a = low.empty ? high.value : low.value;
        var b = high.empty ? low.value : high.value;
        if (a > b) {
            return { error: 'The first number must not be bigger than the second', field: highName };
        }
        return { low: a, high: b };
    }

    function span(r) {
        return r.low === r.high ? String(r.low) : r.low + '-' + r.high;
    }

    function build(input) {
        var s = Object.assign(defaults(), input || {});
        var errors = {};
        var hints = {};
        var entries = ['aster:channel'];
        function add(key, value) {
            entries.push(value === undefined ? 'aster:' + key : 'aster:' + key + '=' + value);
        }
        function fail(field, message) {
            if (!errors[field]) {
                errors[field] = message;
            }
        }
        // A text setting: refused when it holds aster:, otherwise its cleaned value ('' writes nothing).
        function text(field, raw) {
            var value = clean(raw);
            if (hasAster(value)) {
                fail(field, NO_ASTER);
                return '';
            }
            return value;
        }
        // A tag list: refused as a whole when any item holds aster:.
        function list(field, raw) {
            var items = tidyList(raw);
            if (items.some(hasAster)) {
                fail(field, NO_ASTER);
                return [];
            }
            return items;
        }

        var mode = MODES.indexOf(s.mode) >= 0 ? s.mode : 'rotation';
        var usesReshuffle = RESHUFFLE_MODES.indexOf(mode) >= 0;
        var usesWeights = WEIGHT_MODES.indexOf(mode) >= 0;

        // Work everything out first, then write in the spec's order.
        var number = wholeNumber(s.number, 1, null);
        if (number.error) {
            fail('number', number.error);
        }
        var name = text('channelName', s.channelName);
        var group = text('group', s.group);

        var genres = list('genres', s.genres);
        var networks = list('networks', s.networks);
        var collections = list('collections', s.collections);
        var libraries = list('libraries', s.libraries);
        var ratings = list('ratings', s.ratings);
        var users = list('users', s.users);
        var type = TYPES.indexOf(s.type) >= 0 ? s.type : 'all';

        var years = range(s.yearFrom, s.yearTo, 1880, 2200, 'yearFrom', 'yearTo');
        if (years.error) {
            fail(years.field, years.error);
        }
        var shortest = wholeNumber(s.shortest, 1, 600);
        if (shortest.error) {
            fail('shortest', shortest.error);
        }
        var longest = wholeNumber(s.longest, 1, 600);
        if (longest.error) {
            fail('longest', longest.error);
        } else if (longest.value !== undefined && shortest.value !== undefined && longest.value < shortest.value) {
            fail('longest', "Longest can't be shorter than Shortest");
            longest = { error: true };
        }

        var blocks = { empty: true };
        if (mode === 'blocks') {
            blocks = range(s.blocksLow, s.blocksHigh, 1, 20, 'blocksLow', 'blocksHigh');
            if (blocks.error) {
                fail(blocks.field, blocks.error);
            }
        }
        var reshuffle = usesReshuffle && RESHUFFLES.indexOf(s.reshuffle) >= 0 ? s.reshuffle : 'day';
        var seed = { empty: true };
        if (usesReshuffle) {
            seed = wholeNumber(s.seed, 0, null);
            if (seed.error) {
                fail('seed', seed.error);
            }
        }

        var weights = [];
        if (usesWeights) {
            var seenShows = [];
            (s.weights || []).forEach(function (row, i) {
                var show = clean(row && row.show);
                if (!show) {
                    return;
                }
                var key = 'weight' + i;
                if (hasAster(show)) {
                    fail(key, NO_ASTER);
                    return;
                }
                if (/:\s*$/.test(show)) {
                    fail(key, "The show name can't end with a colon");
                    return;
                }
                if (seenShows.indexOf(show.toLowerCase()) >= 0) {
                    fail(key, 'This show already has a weight above');
                    return;
                }
                var w = wholeNumber(row.weight, 1, 5);
                if (w.error) {
                    fail(key, w.error);
                    return;
                }
                seenShows.push(show.toLowerCase());
                if (!w.empty && w.value !== 1) {
                    weights.push(show + ':' + w.value);
                }
            });
        }

        var words = String(s.words || '').trim();
        if (hasAster(words)) {
            fail('words', "Can't contain aster: (Aster would read it as a setting)");
            words = '';
        }

        // Write, in the spec's order; anything at its default writes nothing.
        if (number.value !== undefined) {
            add('number', number.value);
        }
        if (mode !== 'rotation') {
            add('mode', mode);
        }
        if (usesReshuffle && reshuffle !== 'day') {
            add('reshuffle', reshuffle);
        }
        if (mode === 'blocks' && blocks.low !== undefined && !(blocks.low === 2 && blocks.high === 4)) {
            add('blocks', span(blocks));
        }
        if (usesReshuffle && seed.value !== undefined && seed.value !== 0) {
            add('seed', seed.value);
        }
        if (s.logo) {
            add('logo', 'on');
        }
        if (s.bug) {
            add('bug', 'on');
            var corner = CORNERS.indexOf(s.bugLocation) >= 0 ? s.bugLocation : 'bottom-right';
            if (corner !== 'bottom-right') {
                add('bug-location', corner);
            }
            var size = parseInt(s.bugSize, 10);
            if (size >= 25 && size <= 300 && size !== 100) {
                add('bug-size', size + '%');
            }
            var hide = parseInt(s.bugHide, 10);
            if (hide >= 1 && hide <= 3600) {
                add('bug-hide', hide);
            }
            var opacity = parseInt(s.bugOpacity, 10);
            if (opacity >= 5 && opacity <= 100 && opacity !== 45) {
                add('bug-opacity', opacity + '%');
            }
        }
        genres.forEach(function (g) { add('genre', g); });
        if (type !== 'all') {
            add('type', type);
        }
        libraries.forEach(function (l) { add('library', l); });
        networks.forEach(function (n) { add('network', n); });
        collections.forEach(function (c) { add('collection', c); });
        if (years.low !== undefined) {
            add('years', span(years));
        }
        ratings.forEach(function (r) { add('rating', r); });
        weights.forEach(function (w) { add('weight', w); });
        if (shortest.value !== undefined) {
            add('min-length', shortest.value);
        }
        if (longest.value !== undefined) {
            add('max-length', longest.value);
        }
        users.forEach(function (u) { add('user', u); });
        if (name) {
            add('channel-name', name);
        }
        if (group) {
            add('group', group);
        }

        // Hints, not errors.
        var sources = genres.length + networks.length + collections.length > 0;
        var narrows = type !== 'all' || libraries.length > 0 || years.low !== undefined || ratings.length > 0;
        if (narrows && !sources) {
            hints.narrow = 'These only narrow genre, network and collection channels.';
        }
        if (sources) {
            hints.sources = "Use an empty Plex playlist for this channel, or it plays the playlist's titles too.";
        }

        var line = entries.join(', ');
        return {
            output: words ? words + '\n\n' + line : line,
            line: line,
            entries: entries,
            errors: errors,
            hints: hints
        };
    }

    // Aster's own split: at a comma followed (after spaces) by aster:, ignoring case.
    function split(line) {
        return line.split(/,\s*(?=aster:)/i);
    }

    // The other way round: a playlist description back into the form's state. Aster reads everything before the
    // first aster: as plain words, then the settings line. Keys are read as Aster reads them (any case, the old
    // asterfin: prefix too); values Aster would ignore are left at their defaults. Settings this form doesn't have
    // (breaks, fillers, alignment) come back in `skipped` so the page can say they'll be dropped.
    function parse(description) {
        var text = String(description || '');
        var s = defaults();
        var skipped = [];
        var at = text.search(/aster(fin)?:/i);
        if (at < 0) {
            s.words = text.trim();
            return { state: s, skipped: skipped, found: false };
        }
        s.words = text.slice(0, at).trim();
        var rest = text.slice(at);
        var lineEnd = rest.search(/[\r\n]/);
        var line = lineEnd < 0 ? rest : rest.slice(0, lineEnd);

        function commaList(value) {
            return (value || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        }
        function intIn(value, min, max) {
            var m = /^\s*(\d+)/.exec(value || '');
            if (!m) { return null; }
            var n = parseInt(m[1], 10);
            return n >= min && n <= max ? n : null;
        }
        function rangeIn(value, min, max) {
            var parts = (value || '').split('-');
            var a = intIn(parts[0], min, max);
            var b = parts.length > 1 ? intIn(parts[1], min, max) : a;
            return a !== null && b !== null && parts.length <= 2 ? [Math.min(a, b), Math.max(a, b)] : null;
        }
        function on(value) {
            return value === null || ['off', 'no', 'false', '0'].indexOf(value.trim().toLowerCase()) < 0;
        }

        line.split(/,\s*(?=aster(?:fin)?:)/i).forEach(function (entry) {
            var m = /^\s*aster(?:fin)?:\s*([^=]+?)\s*(?:=(.*))?$/i.exec(entry);
            if (!m) { return; }
            var key = m[1].toLowerCase();
            var value = m[2] === undefined ? null : m[2].trim();
            var n, r;
            switch (key) {
                case 'channel': break;
                case 'number': n = intIn(value, 1, 1e9); s.number = n === null ? '' : String(n); break;
                case 'channel-name': s.channelName = value || ''; break;
                case 'group': s.group = value || ''; break;
                case 'genre': s.genres = s.genres.concat(commaList(value)); break;
                case 'network': if (value) { s.networks.push(value); } break;
                case 'collection': if (value) { s.collections.push(value); } break;
                case 'library': s.libraries = s.libraries.concat(commaList(value)); break;
                case 'rating': s.ratings = s.ratings.concat(commaList(value)); break;
                case 'user': case 'users': s.users = s.users.concat(commaList(value)); break;
                case 'type': if (TYPES.indexOf((value || '').toLowerCase()) >= 0) { s.type = value.toLowerCase(); } break;
                case 'years': r = rangeIn(value, 1880, 2200); if (r) { s.yearFrom = String(r[0]); s.yearTo = String(r[1]); } break;
                case 'min-length': n = intIn(value, 1, 600); s.shortest = n === null ? '' : String(n); break;
                case 'max-length': n = intIn(value, 1, 600); s.longest = n === null ? '' : String(n); break;
                case 'mode': if (MODES.indexOf((value || '').toLowerCase()) >= 0) { s.mode = value.toLowerCase(); } break;
                case 'blocks': r = rangeIn(value, 1, 20); if (r) { s.blocksLow = String(r[0]); s.blocksHigh = String(r[1]); } break;
                case 'reshuffle': if (RESHUFFLES.indexOf((value || '').toLowerCase()) >= 0) { s.reshuffle = value.toLowerCase(); } break;
                case 'seed': n = intIn(value, 0, 1e9); s.seed = n === null || n === 0 ? '' : String(n); break;
                case 'weight':
                    var colon = (value || '').lastIndexOf(':');
                    n = colon > 0 ? intIn(value.slice(colon + 1), 1, 1e9) : null;
                    if (n !== null) {
                        s.weights.push({ show: value.slice(0, colon).trim(), weight: String(Math.min(n, 5)) });
                    }
                    break;
                case 'logo': s.logo = on(value); break;
                case 'bug': s.bug = on(value); break;
                case 'bug-location': if (CORNERS.indexOf((value || '').toLowerCase()) >= 0) { s.bugLocation = value.toLowerCase(); } break;
                case 'bug-size': n = intIn(value, 25, 300); if (n !== null) { s.bugSize = n; } break;
                case 'bug-opacity': n = intIn(value, 5, 100); if (n !== null) { s.bugOpacity = n; } break;
                case 'bug-hide': n = intIn(value, 1, 3600); s.bugHide = n === null ? '' : String(n); break;
                default: skipped.push(key);
            }
        });
        // A range at Aster's default reads back as empty boxes, as a fresh form would have them.
        if (s.blocksLow === '2' && s.blocksHigh === '4') { s.blocksLow = ''; s.blocksHigh = ''; }
        if (s.yearFrom && s.yearFrom === s.yearTo) { s.yearTo = ''; }
        if (s.blocksLow && s.blocksLow === s.blocksHigh) { s.blocksHigh = ''; }
        s.genres = tidyList(s.genres); s.libraries = tidyList(s.libraries); s.ratings = tidyList(s.ratings);
        s.users = tidyList(s.users); s.networks = tidyList(s.networks); s.collections = tidyList(s.collections);
        return { state: s, skipped: skipped.filter(function (k, i) { return skipped.indexOf(k) === i; }), found: true };
    }

    return { defaults: defaults, build: build, split: split, parse: parse, MODES: MODES };
});
