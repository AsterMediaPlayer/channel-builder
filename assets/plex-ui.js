/* The "Your Plex library" section: sign in, pick a server and playlist, fill the suggestion lists, and load a
   playlist's current settings into the form. Read-only. Server-provided names are only ever set as text or as
   option values, never as HTML. */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var token = null;
    var serverList = [];
    var conn = null;
    var playlistList = [];
    var loadSeq = 0;   // ignore answers from a server the user has since moved away from

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

    function showSignedIn(signedIn) {
        $('plex-out').hidden = signedIn;
        $('plex-in').hidden = !signedIn;
        $('plex-waiting').hidden = true;
    }

    function signedOut(message) {
        Plex.signOut();
        token = null;
        conn = null;
        serverList = [];
        playlistList = [];
        clearSuggestions();
        showSignedIn(false);
        status(message || '');
    }

    function option(value, label) {
        var o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        return o;
    }

    // ---- after signing in -------------------------------------------------------------------------------------

    function start() {
        status('Loading your account…');
        Plex.account(token).then(function (me) {
            $('plex-user').textContent = me.username || me.title || me.email || 'your Plex account';
            showSignedIn(true);
            Plex.users(token).then(function (names) { fillList('users-list', names); });
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
        }).catch(function (e) {
            if (e.status === 401) {
                signedOut('Your Plex sign-in has expired. Sign in again.');
            } else {
                status("Couldn't reach plex.tv: " + e.message, true);
            }
        });
    }

    function chooseServer(i) {
        var seq = ++loadSeq;
        var sv = serverList[i];
        conn = null;
        clearSuggestions();
        Plex.users(token).then(function (names) { if (seq === loadSeq) { fillList('users-list', names); } });
        $('plex-playlist-field').hidden = true;
        $('plex-load-row').hidden = true;
        status('Connecting to ' + sv.name + '…');
        Plex.connect(sv).then(function (uri) {
            if (seq !== loadSeq) { return; }
            conn = { uri: uri, token: sv.token };
            status('Reading ' + sv.name + '…');
            return Promise.all([Plex.library(conn), Plex.playlists(conn).catch(function () { return []; })]);
        }).then(function (res) {
            if (!res || seq !== loadSeq) { return; }
            var lib = res[0];
            fillList('genres-list', lib.genres);
            fillList('networks-list', lib.networks);
            fillList('collections-list', lib.collections);
            fillList('libraries-list', lib.libraries);
            fillList('ratings-list', lib.ratings);
            fillList('shows-list', lib.shows);
            playlistList = res[1];
            var sel = $('plex-playlist');
            sel.textContent = '';
            sel.appendChild(option('', playlistList.length ? 'Choose a playlist…' : 'No video playlists yet'));
            playlistList.forEach(function (p, j) { sel.appendChild(option(String(j), p.title)); });
            $('plex-playlist-field').hidden = false;
            $('plex-load-row').hidden = true;
            status('Suggestions from ' + sv.name + ' are ready: start typing in any name box to see them.');
        }).catch(function (e) {
            if (seq !== loadSeq) { return; }
            status(e.message + ' Check that the server is on, and that Settings ▸ Network ▸ Secure connections isn\'t "Disabled". You can still type names by hand.', true);
        });
    }

    // ---- events -------------------------------------------------------------------------------------------------

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

    $('plex-playlist').addEventListener('change', function (e) {
        $('plex-load-row').hidden = e.target.value === '';
    });

    $('plex-load').addEventListener('click', function () {
        var p = playlistList[parseInt($('plex-playlist').value, 10)];
        if (!p) { return; }
        var r = ChannelLine.parse(p.summary);
        window.ChannelBuilderForm.setForm(r.state);
        var msg = r.found ? 'Loaded the settings from "' + p.title + '".' : '"' + p.title + '" isn\'t a channel yet; its description is in Description words.';
        if (r.skipped.length) {
            msg += ' Left out, because this form doesn\'t have them: ' + r.skipped.join(', ') + '.';
        }
        status(msg);
    });

    // Still signed in from earlier in this tab?
    token = Plex.getToken();
    if (token) { start(); }
})();
