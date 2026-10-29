/* The "Your Plex library" section: sign in, pick a server and playlist, fill the suggestion lists, load a
   playlist's settings, see what a playlist holds, and (after the user confirms exactly what will change) save the
   line to a playlist, change what's in it, or create a new channel playlist. Server-provided names are only ever
   set as text or option values, never as HTML. */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var token = null;
    var serverList = [];
    var server = null;      // the chosen server
    var conn = null;        // { uri, token, machine } once connected
    var sections = [];
    var playlistList = [];
    var picked = [];        // titles chosen for a new channel: { key, title, year, kind, episodes }
    var contents = null;    // what the chosen playlist holds (Plex.playlistContents)
    var removing = {};      // staged removals, by show/movie key
    var adding = [];        // staged additions: search results
    var pending = null;     // what Confirm will do: { run, done }
    var loadSeq = 0;        // ignore answers from a server the user has since moved away from
    var contentsSeq = 0;    // ...and from a playlist they have since moved away from

    function status(text, bad) {
        var p = $('plex-status');
        p.textContent = text || '';
        p.hidden = !text;
        p.classList.toggle('bad', !!bad);
    }

    function fillList(id, values) {
        var dl = $(id);
        dl.textContent = '';
        values.forEach(function (v) {
            var o = document.createElement('option');
            o.value = v;
            dl.appendChild(o);
        });
    }

    function clearSuggestions() {
        ['genres-list', 'networks-list', 'collections-list', 'libraries-list', 'ratings-list', 'users-list', 'shows-list']
            .forEach(function (id) { fillList(id, []); });
    }

    function el(tag, className, text) {
        var e = document.createElement(tag);
        if (className) { e.className = className; }
        if (text !== undefined) { e.textContent = text; }
        return e;
    }

    function option(value, label) {
        var o = el('option', null, label);
        o.value = value;
        return o;
    }

    function smallButton(label, onClick, ghost) {
        var b = el('button', 'btn small' + (ghost === false ? '' : ' ghost'), label);
        b.type = 'button';
        b.addEventListener('click', onClick);
        return b;
    }

    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    // "Show · 84 episodes", "Movie · 1999"
    function detail(it) {
        if (it.kind === 'Show') { return 'Show' + (it.episodes ? ' · ' + plural(it.episodes, 'episode', 'episodes') : ''); }
        return 'Movie' + (it.year ? ' · ' + it.year : '');
    }

    function showSignedIn(signedIn) {
        $('plex-out').hidden = signedIn;
        $('plex-in').hidden = !signedIn;
        $('plex-waiting').hidden = true;
    }

    function resetPanels() {
        $('plex-load-row').hidden = true;
        $('plex-readonly').hidden = true;
        $('plex-new').hidden = true;
        $('plex-contents').hidden = true;
        contents = null;
        removing = {};
        adding = [];
        cancelConfirm();
    }

    function signedOut(message) {
        Plex.signOut();
        token = null;
        server = null;
        conn = null;
        serverList = [];
        playlistList = [];
        picked = [];
        clearSuggestions();
        resetPanels();
        showSignedIn(false);
        status(message || '');
    }

    function failed(e, what) {
        if (e && e.status === 401) {
            signedOut('Your Plex sign-in has expired. Sign in again.');
        } else {
            status(what + ': ' + (e && e.message ? e.message : e), true);
        }
    }

    // ---- after signing in -------------------------------------------------------------------------------------

    function start() {
        status('Loading your account…');
        Plex.account(token).then(function (me) {
            $('plex-user').textContent = me.username || me.title || me.email || 'your Plex account';
            showSignedIn(true);
            return Plex.servers(token);
        }).then(function (list) {
            serverList = list;
            var sel = $('plex-server');
            sel.textContent = '';
            if (!list.length) {
                status("This Plex account doesn't have any servers.", true);
                return;
            }
            list.forEach(function (sv, i) { sel.appendChild(option(String(i), sv.name + (sv.owned ? '' : ' (shared with you)'))); });
            chooseServer(0);
        }).catch(function (e) { failed(e, "Couldn't reach plex.tv"); });
    }

    function chooseServer(i) {
        var seq = ++loadSeq;
        server = serverList[i];
        conn = null;
        sections = [];
        picked = [];
        renderPicked();
        clearSuggestions();
        resetPanels();
        $('plex-playlist-field').hidden = true;
        Plex.users(token).then(function (names) { if (seq === loadSeq) { fillList('users-list', names); } });
        status('Connecting to ' + server.name + '…');
        Plex.connect(server).then(function (uri) {
            if (seq !== loadSeq) { return; }
            conn = { uri: uri, token: server.token, machine: server.id };
            status('Reading ' + server.name + '…');
            return Promise.all([Plex.library(conn), Plex.playlists(conn).catch(function () { return []; })]);
        }).then(function (res) {
            if (!res || seq !== loadSeq) { return; }
            var lib = res[0];
            sections = lib.sections;
            fillList('genres-list', lib.genres);
            fillList('networks-list', lib.networks);
            fillList('collections-list', lib.collections);
            fillList('libraries-list', lib.libraries);
            fillList('ratings-list', lib.ratings);
            fillList('shows-list', lib.shows);
            showPlaylists(res[1], '');
            status('Suggestions from ' + server.name + ' are ready: start typing in any name box to see them.');
        }).catch(function (e) {
            if (seq !== loadSeq) { return; }
            status(e.message + ' Check that the server is on, and that Settings ▸ Network ▸ Secure connections isn\'t "Disabled". You can still type names by hand.', true);
        });
    }

    function showPlaylists(list, selectId) {
        playlistList = list;
        var sel = $('plex-playlist');
        sel.textContent = '';
        sel.appendChild(option('', 'Choose a playlist…'));
        if (server.owned) { sel.appendChild(option('new', '＋ New channel…')); }
        playlistList.forEach(function (p, j) { sel.appendChild(option(String(j), p.title)); });
        $('plex-playlist-field').hidden = false;
        var idx = playlistList.findIndex(function (p) { return String(p.id) === String(selectId); });
        sel.value = idx >= 0 ? String(idx) : '';
        playlistChanged();
    }

    function chosenPlaylist() {
        return playlistList[parseInt($('plex-playlist').value, 10)];
    }

    function playlistChanged() {
        var v = $('plex-playlist').value;
        cancelConfirm();
        removing = {};
        adding = [];
        $('plex-new').hidden = v !== 'new';
        $('plex-load-row').hidden = v === '' || v === 'new';
        $('plex-save').hidden = !server || !server.owned;
        $('plex-readonly').hidden = !server || server.owned;
        var p = chosenPlaylist();
        if (p) { loadContents(p); } else { $('plex-contents').hidden = true; contents = null; }
    }

    // ---- searching the library (shared by "New channel" and editing a playlist) -------------------------------

    function searchBox(inputId, resultsId, isIn, onAdd) {
        var timer = null;
        var seq = 0;
        var input = $(inputId);
        var ul = $(resultsId);
        function render(results) {
            ul.textContent = '';
            results.forEach(function (it) {
                var li = el('li');
                var span = el('span', null, it.title + ' ');
                span.appendChild(el('small', null, detail(it) + ' · ' + it.library));
                var already = isIn(it.key);
                var b = smallButton(already || 'Add', function () {
                    onAdd(it);
                    b.textContent = isIn(it.key) || 'Added';
                    b.disabled = true;
                });
                b.disabled = !!already;
                li.appendChild(span);
                li.appendChild(b);
                ul.appendChild(li);
            });
            if (!results.length) { ul.appendChild(el('li', null, 'Nothing in your movie or TV libraries matches that.')); }
            ul.hidden = false;
        }
        input.addEventListener('input', function () {
            var text = input.value.trim();
            clearTimeout(timer);
            if (text.length < 2 || !conn) { ul.hidden = true; return; }
            timer = setTimeout(function () {
                var mine = ++seq;
                Plex.search(conn, sections, text).then(function (results) { if (mine === seq) { render(results); } });
            }, 300);
        });
        return { clear: function () { input.value = ''; ul.hidden = true; ul.textContent = ''; } };
    }

    // ---- new channel ------------------------------------------------------------------------------------------

    function renderPicked() {
        var ul = $('plex-picked');
        ul.textContent = '';
        picked.forEach(function (it, i) {
            var li = el('li');
            var span = el('span', null, it.title + ' ');
            span.appendChild(el('small', null, detail(it)));
            li.appendChild(span);
            li.appendChild(smallButton('Remove', function () { picked.splice(i, 1); renderPicked(); }));
            ul.appendChild(li);
        });
        ul.hidden = !picked.length;
    }

    var newSearch = searchBox('plex-search', 'plex-results',
        function (key) { return picked.some(function (p) { return p.key === key; }) ? 'Added' : null; },
        function (it) { if (!picked.some(function (p) { return p.key === it.key; })) { picked.push(it); renderPicked(); } });

    // ---- what's in a playlist, and changing it ------------------------------------------------------------------

    function loadContents(p) {
        var seq = ++contentsSeq;
        contents = null;
        $('plex-contents').hidden = false;
        $('plex-contents-list').textContent = '';
        $('plex-contents-summary').textContent = 'Reading "' + p.title + '"…';
        $('plex-edit-add').hidden = true;
        $('plex-contents-actions').hidden = true;
        editSearch.clear();
        Plex.playlistContents(conn, p.id).then(function (c) {
            if (seq !== contentsSeq) { return; }
            contents = c;
            renderContents();
        }).catch(function (e) {
            if (seq !== contentsSeq) { return; }
            $('plex-contents-summary').textContent = "Couldn't read what's in this playlist: " + e.message;
        });
    }

    function hasChanges() {
        return Object.keys(removing).length > 0 || adding.length > 0;
    }

    function renderContents() {
        var c = contents;
        if (!c) { return; }
        var owned = server && server.owned;
        var ul = $('plex-contents-list');
        ul.textContent = '';
        var parts = [];
        if (c.shows.length) { parts.push(plural(c.shows.length, 'show', 'shows')); }
        if (c.movies.length) { parts.push(plural(c.movies.length, 'movie', 'movies')); }
        if (c.other.length) { parts.push(plural(c.other.length, 'other video', 'other videos')); }
        $('plex-contents-summary').textContent = c.total
            ? parts.join(', ') + ' (' + plural(c.total, 'item', 'items') + ').'
            : 'Empty. As a channel it plays only what its genres, networks or collections bring in.';

        function row(it, text, sub, key) {
            var li = el('li', 'item' + (removing[key] ? ' removing' : ''));
            var span = el('span', null, text + ' ');
            span.appendChild(el('small', null, sub));
            li.appendChild(span);
            if (owned && key) {
                li.appendChild(smallButton(removing[key] ? 'Undo' : 'Remove', function () {
                    if (removing[key]) { delete removing[key]; } else { removing[key] = it.itemIds; }
                    renderContents();
                }));
            }
            ul.appendChild(li);
        }
        if (c.shows.length) {
            ul.appendChild(el('li', 'group', 'Shows'));
            c.shows.forEach(function (sh) {
                var count = sh.episodes && sh.episodes !== sh.inPlaylist
                    ? sh.inPlaylist + ' of ' + plural(sh.episodes, 'episode', 'episodes')
                    : plural(sh.inPlaylist, 'episode', 'episodes');
                row(sh, sh.title, count, 'show:' + sh.key);
            });
        }
        if (c.movies.length) {
            ul.appendChild(el('li', 'group', 'Movies'));
            c.movies.forEach(function (mv) { row(mv, mv.title, mv.year ? String(mv.year) : 'Movie', 'movie:' + mv.key + ':' + mv.itemIds[0]); });
        }
        if (c.other.length) {
            ul.appendChild(el('li', 'group', 'Other videos'));
            c.other.forEach(function (o, i) { row(o, o.title, o.type || 'Video', 'other:' + i + ':' + o.itemIds[0]); });
        }
        if (adding.length) {
            ul.appendChild(el('li', 'group', 'To add'));
            adding.forEach(function (it, i) {
                var li = el('li', 'item adding');
                var span = el('span', null, it.title + ' ');
                span.appendChild(el('small', null, detail(it)));
                li.appendChild(span);
                li.appendChild(smallButton("Don't add", function () { adding.splice(i, 1); renderContents(); }));
                ul.appendChild(li);
            });
        }
        $('plex-edit-add').hidden = !owned;
        $('plex-contents-actions').hidden = !owned || !hasChanges();
    }

    // In the playlist already, or about to be added?
    function inPlaylist(key) {
        if (adding.some(function (a) { return a.key === key; })) { return 'To add'; }
        if (!contents) { return null; }
        if (contents.shows.some(function (sh) { return sh.key === key && !removing['show:' + key]; })) { return 'In it'; }
        if (contents.movies.some(function (mv) { return mv.key === key; })) { return 'In it'; }
        return null;
    }

    var editSearch = searchBox('plex-edit-search', 'plex-edit-results', inPlaylist, function (it) {
        if (!inPlaylist(it.key)) { adding.push(it); renderContents(); }
    });

    $('plex-contents-discard').addEventListener('click', function () {
        removing = {};
        adding = [];
        editSearch.clear();
        renderContents();
    });

    $('plex-contents-save').addEventListener('click', function () {
        var p = chosenPlaylist();
        if (!p || !contents || !hasChanges()) { return; }
        var names = function (filter) {
            var out = [];
            contents.shows.forEach(function (sh) { if (removing['show:' + sh.key]) { out.push(sh.title + ' (' + plural(sh.inPlaylist, 'episode', 'episodes') + ')'); } });
            contents.movies.forEach(function (mv) { if (removing['movie:' + mv.key + ':' + mv.itemIds[0]]) { out.push(mv.title); } });
            contents.other.forEach(function (o, i) { if (removing['other:' + i + ':' + o.itemIds[0]]) { out.push(o.title); } });
            return out;
        };
        var gone = names();
        var what = [];
        if (gone.length) { what.push('Take out: ' + gone.join(', ') + '.'); }
        if (adding.length) { what.push('Add at the end: ' + adding.map(function (a) { return a.title + (a.kind === 'Show' ? ' (all episodes)' : ''); }).join(', ') + '.'); }
        what.push("The playlist's description isn't changed.");
        var itemIds = [].concat.apply([], Object.keys(removing).map(function (k) { return removing[k]; }));
        var keys = adding.map(function (a) { return a.key; });
        askToConfirm({
            title: 'Change what\'s in "' + p.title + '"?',
            what: what.join(' '),
            yes: 'Save playlist changes',
            working: 'Saving the playlist…',
            run: function () {
                return Plex.removeItems(conn, p.id, itemIds).then(function () { return Plex.addItems(conn, p.id, keys); }).then(function () { return p.id; });
            },
            done: function () {
                removing = {};
                adding = [];
                editSearch.clear();
                loadContents(p);
                status('Saved. Aster picks up the change the next time its Channels tab opens.');
            }
        });
    });

    // ---- confirm, then write ---------------------------------------------------------------------------------

    function cancelConfirm() {
        pending = null;
        $('plex-confirm').hidden = true;
    }

    function askToConfirm(o) {
        pending = o;
        $('plex-confirm-title').textContent = o.title;
        $('plex-confirm-what').textContent = o.what;
        $('plex-confirm-before-box').hidden = o.before === undefined;
        $('plex-confirm-before').textContent = o.before || '(empty)';
        $('plex-confirm-after-label').hidden = o.after === undefined;
        $('plex-confirm-after').hidden = o.after === undefined;
        $('plex-confirm-after').textContent = o.after || '';
        $('plex-confirm-yes').textContent = o.yes;
        $('plex-confirm').hidden = false;
        $('plex-confirm-yes').focus();
    }

    // The line as it stands, or null (with a message) while the form has problems.
    function currentLine() {
        var r = window.ChannelBuilderForm.result();
        if (Object.keys(r.errors).length) {
            status('Fix the problems listed above "Your line" first, so nothing you chose gets left out.', true);
            return null;
        }
        return r;
    }

    $('plex-save').addEventListener('click', function () {
        var p = chosenPlaylist();
        var r = p && currentLine();
        if (!r) { return; }
        askToConfirm({
            title: 'Save to "' + p.title + '"?',
            what: "This replaces the playlist's whole description on " + server.name + ". What's in the playlist doesn't change.",
            before: p.summary,
            after: r.output,
            yes: 'Save',
            working: 'Saving…',
            run: function () { return Plex.saveDescription(conn, p.id, r.output).then(function () { return p.id; }); },
            done: function (id) {
                return Plex.playlists(conn).then(function (list) {
                    showPlaylists(list, id);
                    status('Saved. Aster picks it up the next time its Channels tab opens.');
                });
            }
        });
    });

    $('plex-create').addEventListener('click', function () {
        var title = $('plex-new-title').value.replace(/[\r\n]+/g, ' ').trim();
        var err = $('plex-new-title-err');
        err.hidden = !!title;
        err.textContent = title ? '' : 'Give the new playlist a name.';
        if (!title) { $('plex-new-title').focus(); return; }
        var r = currentLine();
        if (!r) { return; }
        var fillsItself = /aster:(genre|network|collection)=/i.test(r.entries.join(' '));
        var what = picked.length
            ? 'A new playlist "' + title + '" on ' + server.name + ', with ' + plural(picked.length, 'show or movie', 'shows and movies') + (fillsItself ? ', plus everything from the genres, networks or collections you chose.' : '.')
            : fillsItself
                ? 'A new, empty playlist "' + title + '" on ' + server.name + '. It fills itself from the genres, networks or collections you chose.'
                : 'A new, empty playlist "' + title + '" on ' + server.name + '. It has no shows or movies and no genre, network or collection yet, so the channel will have nothing to play until you add some.';
        askToConfirm({
            title: 'Create this channel?',
            what: what,
            after: r.output,
            yes: 'Create channel',
            working: 'Creating the channel…',
            run: function () { return Plex.createChannel(conn, title, picked.map(function (it) { return it.key; }), r.output); },
            done: function (id) {
                picked = [];
                renderPicked();
                $('plex-new-title').value = '';
                newSearch.clear();
                return Plex.playlists(conn).then(function (list) {
                    showPlaylists(list, id);
                    status('Created. Aster picks it up the next time its Channels tab opens.');
                });
            }
        });
    });

    $('plex-confirm-no').addEventListener('click', cancelConfirm);

    $('plex-confirm-yes').addEventListener('click', function () {
        if (!pending) { return; }
        var job = pending;
        var yes = $('plex-confirm-yes');
        yes.disabled = true;
        status(job.working);
        job.run().then(function (id) {
            cancelConfirm();
            return job.done(id);
        }).catch(function (e) {
            failed(e, "Couldn't save");
        }).then(function () { yes.disabled = false; });
    });

    // ---- sign-in events -----------------------------------------------------------------------------------------

    $('plex-signin').addEventListener('click', function () {
        // Open the window now, while this is still the user's click, or popup blockers stop it.
        var popup = window.open('', 'plex-sign-in', 'width=600,height=720');
        status('');
        Plex.signIn(popup, function () {
            $('plex-out').hidden = true;
            $('plex-waiting').hidden = false;
        }).then(function (t) {
            token = t;
            start();
        }).catch(function (e) {
            try { if (popup && !popup.closed) { popup.close(); } } catch (x) { /* ignore */ }
            showSignedIn(false);
            status("Couldn't sign in: " + e.message, true);
        });
    });

    $('plex-signout').addEventListener('click', function () {
        signedOut('Signed out. Your sign-in has been removed from this tab.');
    });

    $('plex-server').addEventListener('change', function (e) { chooseServer(parseInt(e.target.value, 10)); });
    $('plex-playlist').addEventListener('change', playlistChanged);

    $('plex-load').addEventListener('click', function () {
        var p = chosenPlaylist();
        if (!p) { return; }
        var r = ChannelLine.parse(p.summary);
        window.ChannelBuilderForm.setForm(r.state);
        var msg = r.found ? 'Loaded the settings from "' + p.title + '".' : '"' + p.title + '" isn\'t a channel yet; its description is in Description words.';
        if (r.skipped.length) {
            msg += ' Left out, because this form doesn\'t have them: ' + r.skipped.join(', ') + '. Saving would remove them from the playlist.';
        }
        status(msg);
    });

    // Still signed in from earlier in this tab?
    token = Plex.getToken();
    if (token) { start(); }
})();
