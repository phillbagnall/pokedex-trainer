/*
 * Sync: progress across devices via a short code, talking to the
 * self-hosted server in server/index.mjs - no accounts, no passwords.
 *
 * IMPORTANT: API_BASE below is a placeholder. Sync won't work until you
 * deploy server/index.mjs somewhere reachable and change this constant
 * to point at it (see the "Cross-device sync" section in README.md),
 * then push/redeploy the site.
 */
window.Sync = (function () {
  'use strict';

  var API_BASE = 'https://pokedex-sync.example.com';

  var CODE_KEY = 'pokedex.synccode.v1';
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I - unambiguous if written down
  var pushTimer = null;

  function code() {
    try {
      return localStorage.getItem(CODE_KEY);
    } catch (e) {
      return null;
    }
  }

  function setCode(c) {
    try {
      if (c) localStorage.setItem(CODE_KEY, c);
      else localStorage.removeItem(CODE_KEY);
    } catch (e) { /* ignore */ }
  }

  function generateCode() {
    var c = '';
    for (var i = 0; i < 8; i += 1) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return c;
  }

  function pushNow() {
    var c = code();
    if (!c) return Promise.resolve();
    return fetch(API_BASE + '/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: c, progress: Progress.exportAll() })
    }).then(function (res) {
      if (!res.ok) throw new Error('server-error');
      return res.json();
    });
  }

  // Called after every recorded answer - debounced so a fast round of
  // flashcards sends one request, not one per card.
  function schedulePush() {
    if (!code()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushNow().catch(function () { /* offline or server down - next answer retries */ });
    }, 1000);
  }

  function pull(c) {
    return fetch(API_BASE + '/api/progress?code=' + encodeURIComponent(c))
      .then(function (res) {
        if (res.status === 404) throw new Error('not-found');
        if (!res.ok) throw new Error('server-error');
        return res.json();
      })
      .then(function (data) {
        Progress.importAll(data.progress);
        return data;
      });
  }

  function enable() {
    var c = generateCode();
    setCode(c);
    return pushNow().then(function () { return c; }).catch(function (err) {
      setCode(null); // don't leave a code "active" that was never actually saved server-side
      throw err;
    });
  }

  function join(c) {
    c = c.toUpperCase().trim();
    return pull(c).then(function () {
      setCode(c);
      return c;
    });
  }

  function syncNow() {
    var c = code();
    if (!c) return Promise.reject(new Error('no-code'));
    return pull(c);
  }

  function disable() {
    setCode(null);
  }

  return {
    code: code,
    enable: enable,
    join: join,
    syncNow: syncNow,
    disable: disable,
    schedulePush: schedulePush
  };
})();
