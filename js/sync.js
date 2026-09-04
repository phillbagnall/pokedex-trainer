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
  // Set as soon as a local answer hasn't been confirmed pushed yet, cleared
  // on a successful push or a fresh pull. Lets reconcileOnBoot tell "this
  // device has offline answers worth protecting" apart from "this device
  // is just being reopened with nothing new" - only the first case should
  // push before it pulls.
  var DIRTY_KEY = 'pokedex.syncdirty.v1';
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

  function isDirty() {
    try {
      return localStorage.getItem(DIRTY_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function setDirty(v) {
    try {
      if (v) localStorage.setItem(DIRTY_KEY, '1');
      else localStorage.removeItem(DIRTY_KEY);
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
    }).then(function (data) {
      setDirty(false);
      return data;
    });
  }

  // Called after every recorded answer - marks this device dirty right
  // away (so a boot reconcile before the debounced push below fires still
  // knows to protect this answer), then actually sends it shortly after,
  // debounced so a fast round of flashcards makes one request, not one
  // per card.
  function schedulePush() {
    if (!code()) return;
    setDirty(true);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushNow().catch(function () { /* offline or server down - stays dirty, retried later */ });
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
        setDirty(false);
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

  /*
   * Called once when the app opens, if sync is on.
   *
   * If this device has unpushed answers (isDirty - e.g. she used it
   * offline since the last successful sync), push them first so the pull
   * that follows can't overwrite them with an older server copy. If it
   * doesn't - the common case of just reopening the app with nothing new
   * - skip straight to pulling, so a stale local copy never gets pushed
   * back over whatever a different device has since saved. That's what
   * makes opening the app on either device safe without her having to
   * remember to tap "Sync now" herself.
   */
  function reconcileOnBoot() {
    var c = code();
    if (!c) return Promise.resolve();
    var maybePush = isDirty() ? pushNow().catch(function () { /* offline - still try the pull below */ }) : Promise.resolve();
    return maybePush.then(function () { return pull(c); });
  }

  function disable() {
    setCode(null);
  }

  return {
    code: code,
    enable: enable,
    join: join,
    syncNow: syncNow,
    reconcileOnBoot: reconcileOnBoot,
    disable: disable,
    schedulePush: schedulePush
  };
})();
