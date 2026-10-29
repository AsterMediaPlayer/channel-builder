/*
 * plex.js: optional "Sign in with Plex", read-only.
 *
 * Talks only to plex.tv and to the user's own Plex servers over their secure *.plex.direct addresses (the page's
 * content-security policy allows nothing else). The sign-in token is kept in sessionStorage, so it lasts until the
 * tab is closed or the user signs out, and is sent nowhere but plex.tv and those servers.
 *
 * Writing (creating a playlist, adding titles, saving its description) only happens through the functions marked
 * WRITES below, which the page calls only after the user has confirmed exactly what will change.
 */
(function (root) {
    'use strict';

    var PRODUCT = 'Aster Channel Builder';
    var TOKEN_KEY = 'aster-channel-builder.plex-token';
    var CLIENT_KEY = 'aster-channel-builder.client-id';

    // A random id for this browser, which Plex shows under Authorized Devices. Not a secret.
    function clientId() {
        var id = null;
        try { id = localStorage.getItem(CLIENT_KEY); } catch (e) { /* private mode */ }
        if (!id) {
            id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
            try { localStorage.setItem(CLIENT_KEY, id); } catch (e) { /* fine: a new id next time */ }
        }
        return id;
    }

    function headers(token) {
        var h = { 'Accept': 'application/json', 'X-Plex-Product': PRODUCT, 'X-Plex-Client-Identifier': clientId() };
        if (token) { h['X-Plex-Token'] = token; }
        return h;
    }

    function getToken() {
        try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
    }
    function setToken(token) {
        try {
            if (token) { sessionStorage.setItem(TOKEN_KEY, token); } else { sessionStorage.removeItem(TOKEN_KEY); }
        } catch (e) { /* the token then lasts only for this page view */ }
    }

    function json(response) {
        if (!response.ok) {
            var err = new Error('Plex answered ' + response.status);
            err.status = response.status;
            throw err;
        }
        return response.json();
    }

    function withTimeout(promise, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error('timed out')); }, ms);
            promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }

    // ---- sign-in: Plex's PIN flow, the same "link code" sign-in apps use ----------------------------------------

    // The popup must be opened straight from the click (or browsers block it), so the caller passes it in.
    function signIn(popup, onWaiting) {
        return fetch('https://plex.tv/api/v2/pins?strong=true', { method: 'POST', headers: headers() })
            .then(json)
            .then(function (pin) {
                var url = 'https://app.plex.tv/auth#?' + [
                    'clientID=' + encodeURIComponent(clientId()),
                    'code=' + encodeURIComponent(pin.code),
                    'context%5Bdevice%5D%5Bproduct%5D=' + encodeURIComponent(PRODUCT)
                ].join('&');
                if (popup && !popup.closed) {
                    popup.location.href = url;
                } else {
                    window.open(url, 'plex-sign-in', 'width=600,height=720');
                }
                if (onWaiting) { onWaiting(); }
                var started = Date.now();
                return new Promise(function (resolve, reject) {
                    (function poll() {
                        fetch('https://plex.tv/api/v2/pins/' + pin.id, { headers: headers() })
                            .then(json)
                            .then(function (p) {
                                if (p.authToken) {
                                    setToken(p.authToken);
                                    try { if (popup && !popup.closed) { popup.close(); } } catch (e) { /* not ours any more */ }
                                    resolve(p.authToken);
                                } else if (Date.now() - started > 5 * 60 * 1000) {
                                    reject(new Error('Sign-in timed out. Try again.'));
                                } else {
                                    setTimeout(poll, 2000);
                                }
                            })
                            .catch(reject);
                    })();
                });
            });
    }

    function signOut() {
        setToken(null);
    }

    function account(token) {
        return fetch('https://plex.tv/api/v2/user', { headers: headers(token) }).then(json);
    }

    // ---- servers ------------------------------------------------------------------------------------------------

    // Every Plex server this account can use, with the addresses to try (https only: this page is https).
    function servers(token) {
        return fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', { headers: headers(token) })
            .then(json)
            .then(function (list) {
                return list.filter(function (r) { return (r.provides || '').split(',').indexOf('server') >= 0; })
                    .map(function (r) {
                        return {
                            id: r.clientIdentifier, name: r.name, owned: !!r.owned, token: r.accessToken || token,
                            uris: (r.connections || []).filter(function (c) { return c.protocol === 'https'; })
                                .sort(function (a, b) { return rank(a) - rank(b); })
                                .map(function (c) { return c.uri; })
                        };
                    })
                    .sort(function (a, b) { return (b.owned - a.owned) || a.name.localeCompare(b.name); });
            });
        function rank(c) { return c.local ? 0 : c.relay ? 2 : 1; }
    }

    // Tries every address at once and keeps the first that answers as this server.
    function connect(server) {
        var attempts = server.uris.map(function (uri) {
            return withTimeout(fetch(uri + '/identity', { headers: headers(server.token) }).then(json), 6000)
                .then(function (id) {
                    if (id.MediaContainer && id.MediaContainer.machineIdentifier !== server.id) { throw new Error('a different server'); }
                    return uri;
                });
        });
        return new Promise(function (resolve, reject) {
            var left = attempts.length;
            if (!left) { reject(new Error('This server has no secure address.')); return; }
            attempts.forEach(function (p) {
                p.then(resolve, function () {
                    left -= 1;
                    if (!left) { reject(new Error("Couldn't reach this server over a secure connection.")); }
                });
            });
        });
    }

    // ---- reading the library --------------------------------------------------------------------------------------

    function get(conn, path) {
        return fetch(conn.uri + path, { headers: headers(conn.token) }).then(json).then(function (d) { return d.MediaContainer || {}; });
    }
    function titles(mc) {
        return (mc.Directory || mc.Metadata || []).map(function (x) { return x.title; }).filter(Boolean);
    }
    function uniqueSorted(lists) {
        var seen = {};
        var out = [];
        lists.forEach(function (l) {
            l.forEach(function (t) {
                var k = t.toLowerCase();
                if (!seen[k]) { seen[k] = true; out.push(t); }
            });
        });
        return out.sort(function (a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base' }); });
    }
    function quietly(promise) {
        return promise.then(titles, function () { return []; });
    }

    // Everything the form can suggest, from the movie and TV libraries. "Networks" is a show's network or a
    // movie's studio, as the spec defines it.
    function library(conn) {
        return get(conn, '/library/sections').then(function (mc) {
            var sections = (mc.Directory || []).filter(function (d) { return d.type === 'movie' || d.type === 'show'; });
            var jobs = sections.map(function (d) {
                var base = '/library/sections/' + encodeURIComponent(d.key);
                return Promise.all([
                    quietly(get(conn, base + '/genre')),
                    quietly(get(conn, base + '/collections')),
                    quietly(get(conn, base + (d.type === 'show' ? '/network' : '/studio'))),
                    quietly(get(conn, base + '/contentRating')),
                    d.type === 'show' ? quietly(get(conn, base + '/all?type=2')) : Promise.resolve([])
                ]);
            });
            return Promise.all(jobs).then(function (res) {
                function col(i) { return uniqueSorted(res.map(function (r) { return r[i]; })); }
                return {
                    sections: sections.map(function (d) { return { key: d.key, type: d.type, title: d.title }; }),
                    libraries: uniqueSorted([sections.map(function (d) { return d.title; })]),
                    genres: col(0), collections: col(1), networks: col(2), ratings: col(3), shows: col(4)
                };
            });
        });
    }

    // The account's Plex Home users (owner, admins and managed users). Empty for anyone who can't list them.
    function users(token) {
        return fetch('https://plex.tv/api/v2/home/users', { headers: headers(token) })
            .then(json)
            .then(function (d) {
                return uniqueSorted([(d.users || []).map(function (u) { return u.title || u.username; }).filter(Boolean)]);
            }, function () { return []; });
    }

    // The server's ordinary (not smart) video playlists, with their descriptions.
    function playlists(conn) {
        return get(conn, '/playlists?playlistType=video').then(function (mc) {
            return (mc.Metadata || []).filter(function (m) { return !m.smart; }).map(function (m) {
                return { id: m.ratingKey, title: m.title, summary: m.summary || '' };
            }).sort(function (a, b) { return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }); });
        });
    }

    // Shows and movies whose title contains the text, from the movie and TV libraries (for "Add shows or movies").
    function search(conn, sections, text) {
        var q = encodeURIComponent(text);
        return Promise.all(sections.map(function (d) {
            var type = d.type === 'show' ? 2 : 1;
            return fetch(conn.uri + '/library/sections/' + encodeURIComponent(d.key) + '/all?type=' + type + '&title=' + q,
                { headers: Object.assign(headers(conn.token), { 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': '25' }) })
                .then(json)
                .then(function (data) {
                    return ((data.MediaContainer || {}).Metadata || []).map(function (m) {
                        return { key: m.ratingKey, title: m.title, year: m.year, kind: d.type === 'show' ? 'Show' : 'Movie', library: d.title, episodes: m.leafCount };
                    });
                }, function () { return []; });
        })).then(function (lists) {
            return [].concat.apply([], lists).sort(function (a, b) { return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }); }).slice(0, 40);
        });
    }

    function itemsUri(conn, keys) {
        return 'server://' + conn.machine + '/com.plexapp.plugins.library/library/metadata/' + keys.map(encodeURIComponent).join(',');
    }

    function send(conn, method, path) {
        return fetch(conn.uri + path, { method: method, headers: headers(conn.token) }).then(function (r) {
            if (!r.ok) {
                var err = new Error('Plex answered ' + r.status);
                err.status = r.status;
                throw err;
            }
            return r.status === 204 ? null : r.json().catch(function () { return null; });
        });
    }

    // What a playlist holds, grouped as people think of it: shows (with how many of their episodes are in it),
    // movies, and anything else (clips, music videos), counted.
    function playlistContents(conn, playlistId) {
        return fetch(conn.uri + '/playlists/' + encodeURIComponent(playlistId) + '/items',
            { headers: Object.assign(headers(conn.token), { 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': '100000' }) })
            .then(json)
            .then(function (data) {
                var items = (data.MediaContainer || {}).Metadata || [];
                var shows = {};
                var order = [];
                var movies = [];
                var other = [];
                items.forEach(function (m) {
                    if (m.type === 'episode' && m.grandparentRatingKey) {
                        var k = String(m.grandparentRatingKey);
                        if (!shows[k]) {
                            shows[k] = { key: k, title: m.grandparentTitle || 'Unknown show', itemIds: [], inPlaylist: 0, episodes: null };
                            order.push(k);
                        }
                        shows[k].itemIds.push(m.playlistItemID);
                        shows[k].inPlaylist += 1;
                    } else if (m.type === 'movie') {
                        movies.push({ key: String(m.ratingKey), title: m.title, year: m.year, itemIds: [m.playlistItemID] });
                    } else {
                        other.push({ title: m.title, type: m.type, itemIds: [m.playlistItemID] });
                    }
                });
                var showList = order.map(function (k) { return shows[k]; });
                // Each show's total episode count, 50 at a time, so "12 of 84 episodes" can be shown.
                var batches = [];
                for (var i = 0; i < showList.length; i += 50) { batches.push(showList.slice(i, i + 50)); }
                return Promise.all(batches.map(function (batch) {
                    return get(conn, '/library/metadata/' + batch.map(function (sh) { return encodeURIComponent(sh.key); }).join(','))
                        .then(function (mc) {
                            (mc.Metadata || []).forEach(function (m) {
                                if (shows[String(m.ratingKey)]) { shows[String(m.ratingKey)].episodes = m.leafCount; }
                            });
                        }, function () { /* counts are a nicety */ });
                })).then(function () {
                    var byTitle = function (a, b) { return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }); };
                    return { shows: showList.sort(byTitle), movies: movies.sort(byTitle), other: other, total: items.length };
                });
            });
    }

    // WRITES: takes items out of a playlist, a few at a time (Plex removes one playlist item per request).
    function removeItems(conn, playlistId, itemIds) {
        var queue = itemIds.slice();
        var base = '/playlists/' + encodeURIComponent(playlistId) + '/items/';
        function worker() {
            var next = queue.shift();
            if (next === undefined) { return Promise.resolve(); }
            return send(conn, 'DELETE', base + encodeURIComponent(next)).then(worker);
        }
        return Promise.all([worker(), worker(), worker(), worker()]);
    }

    // WRITES: adds whole shows (all their episodes) and movies to the end of a playlist.
    function addItems(conn, playlistId, keys) {
        if (!keys.length) { return Promise.resolve(); }
        return send(conn, 'PUT', '/playlists/' + encodeURIComponent(playlistId) + '/items?uri=' + encodeURIComponent(itemsUri(conn, keys)));
    }

    // WRITES: replaces a playlist's description (Plex calls it the summary).
    function saveDescription(conn, playlistId, text) {
        return send(conn, 'PUT', '/playlists/' + encodeURIComponent(playlistId) + '?summary=' + encodeURIComponent(text));
    }

    // WRITES: makes a new video playlist, empty or with whole shows and movies, and gives it its description.
    // Plex only makes a playlist from a list of titles; naming the server with no title gives an empty one.
    function createChannel(conn, title, keys, description) {
        var path = '/playlists?type=video&smart=0&title=' + encodeURIComponent(title) + '&uri=' + encodeURIComponent(itemsUri(conn, keys));
        return send(conn, 'POST', path).then(function (data) {
            var made = data && data.MediaContainer && (data.MediaContainer.Metadata || [])[0];
            if (!made || !made.ratingKey) { throw new Error("Plex didn't say which playlist it made."); }
            return saveDescription(conn, made.ratingKey, description).then(function () { return made.ratingKey; });
        });
    }

    root.Plex = {
        getToken: getToken, signIn: signIn, signOut: signOut, account: account, servers: servers,
        connect: connect, library: library, users: users, playlists: playlists, search: search,
        saveDescription: saveDescription, createChannel: createChannel,
        playlistContents: playlistContents, removeItems: removeItems, addItems: addItems
    };
})(window);
