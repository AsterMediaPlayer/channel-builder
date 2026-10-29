/* The "Your Plex library" section: sign in, pick a server and playlist, fill the suggestion lists, load a
   playlist's settings, and (after the user confirms exactly what will change) save the line to a playlist or
   create a new channel playlist. Server-provided names are only ever set as text or option values, never HTML. */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var token = null;
    var serverList = [];
    var server = null;      // the chosen server
    var conn = null;        // { uri, token, machine } once connected
    var sections = [];
    var playlistList = [];
    var picked = [];        // titles chosen for a new channel: { key, title, year, kind }
    var pending = null;     // what Confirm will do
    var loadSeq = 0;        // ignore answers from a server the user has since moved away from

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

    function option(value, label) {
        var o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        return o;
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

    function playlistChanged() {
        var v = $('plex-playlist').value;
        cancelConfirm();
        $('plex-new').hidden = v !== 'new';
        $('plex-load-row').hidden = v === '' || v === 'new';
        $('plex-save').hidden = !server || !server.owned;
        $('plex-readonly').hidden = !server || server.owned;
    }

    // ---- new channel: search and pick titles --------------------------------------------------------------------

    var searchTimer = null;
    var searchSeq = 0;

    function renderPicked() {
        var ul = $('plex-picked');
        ul.textContent = '';
        picked.forEach(function (it, i) {
            var li = document.createElement('li');
            var span = document.createElement('span');
            span.textContent = it.title + (it.year ? ' (' + it.year + ')' : '') + ' ';
            var small = document.createElement('small');
            small.textContent = it.kind;
            span.appendChild(small);
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn ghost small';
            b.textContent = 'Remove';
            b.addEventListener('click', function () { picked.splice(i, 1); renderPicked(); });
            li.appendChild(span);
            li.appendChild(b);
            ul.appendChild(li);
        });
        ul.hidden = !picked.length;
    }

    function renderResults(results) {
        var ul = $('plex-results');
        ul.textContent = '';
        results.forEach(function (it) {
            var li = document.createElement('li');
            var span = document.createElement('span');
            span.textContent = it.title + (it.year ? ' (' + it.year + ')' : '') + ' ';
            var small = document.createElement('small');
            small.textContent = it.kind + ' · ' + it.library;
            span.appendChild(small);
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn ghost small';
            var already = picked.some(function (p) { return p.key === it.key; });
            b.textContent = already ? 'Added' : 'Add';
            b.disabled = already;
            b.addEventListener('click', function () {
                if (!picked.some(function (p) { return p.key === it.key; })) { picked.push(it); }
                b.textContent = 'Added';
                b.disabled = true;
                renderPicked();
            });
            li.appendChild(span);
            li.appendChild(b);
            ul.appendChild(li);
        });
        if (!results.length) {
            var none = document.createElement('li');
            none.textContent = 'Nothing in your movie or TV libraries matches that.';
            ul.appendChild(none);
        }
        ul.hidden = false;
    }

    $('plex-search').addEventListener('input', function () {
        var text = $('plex-search').value.trim();
        clearTimeout(searchTimer);
        if (text.length < 2 || !conn) {
            $('plex-results').hidden = true;
            return;
        }
        searchTimer = setTimeout(function () {
            var seq = ++searchSeq;
            Plex.search(conn, sections, text).then(function (results) {
                if (seq === searchSeq) { renderResults(results); }
            });
        }, 300);
    });

    // ---- confirm, then write ---------------------------------------------------------------------------------

    function cancelConfirm() {
        pending = null;
        $('plex-confirm').hidden = true;
    }

    function askToConfirm(o) {
        pending = o.run;
        $('plex-confirm-title').textContent = o.title;
        $('plex-confirm-what').textContent = o.what;
        $('plex-confirm-before-box').hidden = o.before === undefined;
        $('plex-confirm-before').textContent = o.before || '(empty)';
        $('plex-confirm-after').textContent = o.after;
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
        var p = playlistList[parseInt($('plex-playlist').value, 10)];
        var r = p && currentLine();
        if (!r) { return; }
        askToConfirm({
            title: 'Save to "' + p.title + '"?',
            what: "This replaces the playlist's whole description on " + server.name + ". Nothing else about the playlist changes.",
            before: p.summary,
            after: r.output,
            yes: 'Save',
            run: function () {
                return Plex.saveDescription(conn, p.id, r.output).then(function () { return p.id; });
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
        var s = r.entries.join(' ');
        var fillsItself = /aster:(genre|network|collection)=/i.test(s);
        var what = picked.length
            ? 'A new playlist "' + title + '" on ' + server.name + ', with ' + picked.length + (picked.length === 1 ? ' show or movie' : ' shows and movies') + (fillsItself ? ', plus everything from the genres, networks or collections you chose.' : '.')
            : fillsItself
                ? 'A new, empty playlist "' + title + '" on ' + server.name + '. It fills itself from the genres, networks or collections you chose.'
                : 'A new, empty playlist "' + title + '" on ' + server.name + '. It has no shows or movies and no genre, network or collection yet, so the channel will have nothing to play until you add some.';
        askToConfirm({
            title: 'Create this channel?',
            what: what,
            after: r.output,
            yes: 'Create channel',
            run: function () {
                return Plex.createChannel(conn, title, picked.map(function (it) { return it.key; }), r.output);
            }
        });
    });

    $('plex-confirm-no').addEventListener('click', cancelConfirm);

    $('plex-confirm-yes').addEventListener('click', function () {
        if (!pending) { return; }
        var run = pending;
        var creating = !$('plex-new').hidden;
        var yes = $('plex-confirm-yes');
        yes.disabled = true;
        status(creating ? 'Creating the channel…' : 'Saving…');
        run().then(function (id) {
            cancelConfirm();
            if (creating) {
                picked = [];
                renderPicked();
                $('plex-new-title').value = '';
                $('plex-search').value = '';
                $('plex-results').hidden = true;
            }
            return Plex.playlists(conn).then(function (list) {
                showPlaylists(list, id);
                status((creating ? 'Created. ' : 'Saved. ') + 'Aster picks it up the next time its Channels tab opens.');
            });
        }).catch(function (e) {
            failed(e, creating ? "Couldn't create the channel" : "Couldn't save");
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
        var p = playlistList[parseInt($('plex-playlist').value, 10)];
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
