/* The page: reads the form on every change, hands it to ChannelLine.build, and shows the line,
   the problems and the hints. No network access at all. */
(function () {
    'use strict';

    var form = document.getElementById('form');
    var output = document.getElementById('output');
    var problemsBox = document.getElementById('problems');
    var weightsBox = document.getElementById('weights');

    var MODE_HELP = {
        rotation: 'One episode of each show in turn; each movie takes a turn of its own.',
        blocks: 'A few episodes of a show in a row (Episodes in a row), then the next show.',
        shuffle: 'Everything in its own random order.',
        sequential: 'The playlist as arranged, round and round.',
        airdate: 'Everything in the order it first aired.'
    };
    var MODE_NOTE = ' Rotation, Blocks and Shuffle deal a new order every day, week or month; Shuffle again deals a different one. Episodes of a show always play in order, picking up where they left off.';

    var LABELS = {
        number: 'Number', channelName: 'Channel name', group: 'Group', genres: 'Genres', networks: 'Networks',
        collections: 'Collections', libraries: 'Libraries', ratings: 'Ratings', yearFrom: 'Years', yearTo: 'Years',
        shortest: 'Shortest', longest: 'Longest', blocksLow: 'Episodes in a row', blocksHigh: 'Episodes in a row',
        seed: 'Seed', users: 'Users', words: 'Description words'
    };

    // ---- tag lists ------------------------------------------------------------------------------------------------

    var lists = {};   // name -> { items: [], input, box, commas }

    function renderTags(name) {
        var l = lists[name];
        l.box.querySelectorAll('.tag').forEach(function (t) { t.remove(); });
        l.items.forEach(function (item, i) {
            var tag = document.createElement('span');
            tag.className = 'tag';
            var text = document.createElement('span');
            text.textContent = item;
            var remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = '×';
            remove.setAttribute('aria-label', 'Remove ' + item);
            remove.addEventListener('click', function () {
                l.items.splice(i, 1);
                renderTags(name);
                update();
                l.input.focus();
            });
            tag.appendChild(text);
            tag.appendChild(remove);
            l.box.insertBefore(tag, l.input);
        });
    }

    function commit(name) {
        var l = lists[name];
        var value = l.input.value.replace(/[\r\n]+/g, ' ').trim();
        l.input.value = '';
        if (value && !l.items.some(function (x) { return x.toLowerCase() === value.toLowerCase(); })) {
            l.items.push(value);
        }
        renderTags(name);
    }

    document.querySelectorAll('.tags').forEach(function (box) {
        var name = box.getAttribute('data-list');
        var input = box.querySelector('input');
        lists[name] = { items: [], input: input, box: box, commas: box.getAttribute('data-commas') === 'yes' };
        box.addEventListener('click', function (e) {
            if (e.target === box) {
                input.focus();
            }
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                commit(name);
                update();
            } else if (e.key === 'Backspace' && input.value === '' && lists[name].items.length) {
                lists[name].items.pop();
                renderTags(name);
                update();
            }
        });
        input.addEventListener('input', function (e) {
            // Picking one of the library's suggestions adds it straight away.
            if (e.inputType === 'insertReplacementText' || (e.inputType === undefined && isSuggestion(input))) {
                commit(name);
                update();
                return;
            }
            // In "no commas" lists a comma finishes the current item (this also splits pasted lists).
            if (!lists[name].commas && input.value.indexOf(',') >= 0) {
                var parts = input.value.split(',');
                var rest = parts.pop();
                parts.forEach(function (p) {
                    input.value = p;
                    commit(name);
                });
                input.value = rest.replace(/^\s+/, '');
            }
            update();
        });
        input.addEventListener('blur', function () {
            if (input.value.trim()) {
                commit(name);
                update();
            }
        });
    });

    function isSuggestion(input) {
        var list = input.list;
        var v = input.value;
        return !!(list && v && Array.prototype.some.call(list.options, function (o) { return o.value === v; }));
    }

    // The typed-but-not-yet-added text counts too, so the line updates on every keystroke.
    function listValue(name) {
        var l = lists[name];
        var pending = l.input.value.trim();
        return pending ? l.items.concat([pending]) : l.items.slice();
    }

    // ---- show weights ---------------------------------------------------------------------------------------------

    var weights = [];

    function renderWeights() {
        weightsBox.textContent = '';
        weights.forEach(function (row, i) {
            var div = document.createElement('div');
            div.className = 'weight-row field';
            div.setAttribute('data-field', 'weight' + i);
            var show = document.createElement('input');
            show.type = 'text';
            show.placeholder = 'Show name';
            show.value = row.show;
            show.setAttribute('aria-label', 'Show name ' + (i + 1));
            show.setAttribute('list', 'shows-list');
            show.addEventListener('input', function () { row.show = show.value; update(); });
            var weight = document.createElement('input');
            weight.type = 'text';
            weight.inputMode = 'numeric';
            weight.placeholder = '2';
            weight.value = row.weight;
            weight.setAttribute('aria-label', 'Weight for show ' + (i + 1));
            weight.addEventListener('input', function () { row.weight = weight.value; update(); });
            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'icon-btn';
            remove.textContent = 'Remove';
            remove.addEventListener('click', function () {
                weights.splice(i, 1);
                renderWeights();
                update();
            });
            var err = document.createElement('p');
            err.className = 'err';
            err.setAttribute('data-err', 'weight' + i);
            err.hidden = true;
            div.appendChild(show);
            div.appendChild(weight);
            div.appendChild(remove);
            div.appendChild(err);
            weightsBox.appendChild(div);
        });
    }

    document.getElementById('add-weight').addEventListener('click', function () {
        weights.push({ show: '', weight: '2' });
        renderWeights();
        update();
        var inputs = weightsBox.querySelectorAll('input[aria-label^="Show name"]');
        inputs[inputs.length - 1].focus();
    });

    // ---- reading the form and showing the result ------------------------------------------------------------------

    function val(id) {
        return document.getElementById(id).value;
    }

    function state() {
        return {
            number: val('number'), channelName: val('channelName'), group: val('group'),
            genres: listValue('genres'), networks: listValue('networks'), collections: listValue('collections'),
            type: val('type'), libraries: listValue('libraries'), yearFrom: val('yearFrom'), yearTo: val('yearTo'),
            ratings: listValue('ratings'), shortest: val('shortest'), longest: val('longest'),
            mode: val('mode'), blocksLow: val('blocksLow'), blocksHigh: val('blocksHigh'),
            reshuffle: val('reshuffle'), seed: val('seed'), weights: weights.slice(),
            logo: document.getElementById('logo').checked, bug: document.getElementById('bug').checked,
            bugLocation: val('bugLocation'), bugSize: val('bugSize'), bugOpacity: val('bugOpacity'), bugHide: val('bugHide'),
            users: listValue('users'), words: val('words')
        };
    }

    function update() {
        var s = state();

        // Show only what the mode and the bug toggle use.
        document.querySelectorAll('[data-modes]').forEach(function (el) {
            el.hidden = el.getAttribute('data-modes').split(' ').indexOf(s.mode) < 0;
        });
        document.getElementById('mode-help').textContent = MODE_HELP[s.mode] + MODE_NOTE;
        document.getElementById('bug-details').hidden = !s.bug;
        document.getElementById('bugSize-out').textContent = s.bugSize + '%';
        document.getElementById('bugOpacity-out').textContent = s.bugOpacity + '%';

        var r = window.ChannelLine.build(s);
        output.value = r.output;

        // Problems: beside each field, and listed above the output.
        document.querySelectorAll('[data-err]').forEach(function (p) {
            var msg = r.errors[p.getAttribute('data-err')];
            p.textContent = msg || '';
            p.hidden = !msg;
        });
        document.querySelectorAll('[data-field]').forEach(function (f) {
            var key = f.getAttribute('data-field');
            var bad = Object.keys(r.errors).some(function (k) {
                return k === key || (key === 'years' && (k === 'yearFrom' || k === 'yearTo')) ||
                    (key === 'blocks' && (k === 'blocksLow' || k === 'blocksHigh'));
            });
            f.classList.toggle('bad', bad);
        });
        problemsBox.textContent = '';
        Object.keys(r.errors).forEach(function (k) {
            var li = document.createElement('li');
            var label = LABELS[k] || (k.indexOf('weight') === 0 ? 'Show weight ' + (parseInt(k.slice(6), 10) + 1) : k);
            li.textContent = label + ': ' + r.errors[k];
            problemsBox.appendChild(li);
        });
        problemsBox.hidden = !problemsBox.children.length;

        document.querySelectorAll('[data-hint]').forEach(function (p) {
            var msg = r.hints[p.getAttribute('data-hint')];
            p.textContent = msg || '';
            p.hidden = !msg;
        });
    }

    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', function (e) { e.preventDefault(); });

    document.getElementById('shuffle-again').addEventListener('click', function () {
        var seed = document.getElementById('seed');
        var n = parseInt(seed.value, 10);
        seed.value = String((isNaN(n) || n < 0 ? 0 : n) + 1);
        update();
    });

    // Puts a whole state into the form, as if typed in.
    function setForm(s) {
        ['number', 'channelName', 'group', 'yearFrom', 'yearTo', 'shortest', 'longest', 'blocksLow', 'blocksHigh', 'seed', 'words']
            .forEach(function (id) { document.getElementById(id).value = s[id] || ''; });
        ['type', 'mode', 'reshuffle', 'bugLocation'].forEach(function (id) { document.getElementById(id).value = s[id]; });
        var hide = document.getElementById('bugHide');
        if (s.bugHide && !Array.prototype.some.call(hide.options, function (o) { return o.value === String(s.bugHide); })) {
            var opt = document.createElement('option');
            opt.value = String(s.bugHide);
            opt.textContent = s.bugHide + ' seconds';
            hide.appendChild(opt);
        }
        hide.value = s.bugHide || '';
        document.getElementById('bugSize').value = s.bugSize;
        document.getElementById('bugOpacity').value = s.bugOpacity;
        document.getElementById('logo').checked = !!s.logo;
        document.getElementById('bug').checked = !!s.bug;
        Object.keys(lists).forEach(function (name) {
            lists[name].items = (s[name] || []).slice();
            lists[name].input.value = '';
            renderTags(name);
        });
        weights = (s.weights || []).map(function (w) { return { show: w.show, weight: w.weight }; });
        renderWeights();
        update();
    }
    window.ChannelBuilderForm = { setForm: setForm, result: function () { return window.ChannelLine.build(state()); } };

    // ---- copy and reset --------------------------------------------------------------------------------------------

    var copyButton = document.getElementById('copy');
    var copyTimer = null;
    copyButton.addEventListener('click', function () {
        var text = output.value;
        function done() {
            copyButton.textContent = 'Copied';
            clearTimeout(copyTimer);
            copyTimer = setTimeout(function () { copyButton.textContent = 'Copy'; }, 2000);
        }
        function fallback() {
            output.focus();
            output.select();
            try {
                document.execCommand('copy');
            } catch (e) { /* the text stays selected for a manual copy */ }
            done();
        }
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(done, fallback);
        } else {
            fallback();
        }
    });

    document.getElementById('reset').addEventListener('click', function () {
        form.reset();
        Object.keys(lists).forEach(function (name) {
            lists[name].items = [];
            lists[name].input.value = '';
            renderTags(name);
        });
        weights = [];
        renderWeights();
        update();
    });

    update();
})();
