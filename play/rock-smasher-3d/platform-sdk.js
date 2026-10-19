/*!
 * platform-sdk.js — one small adapter over the CrazyGames HTML5 SDK (v3),
 * the Poki SDK (v2) and plain web hosting, so a game calls ONE api and stays
 * compliant on every portal.
 *
 * Usage (before the game boots):
 *   <script>window.__GAME_PLATFORM__ = "auto";</script>   // "crazygames" | "poki" | "web" | "mock" | "auto"
 *   <script src="platform-sdk.js"></script>
 *   <script>
 *     Platform.init({
 *       onMute: (muted) => Sound.setMuted(muted),   // called with true when an ad starts, false when it ends
 *       onInputLock: (locked) => input.enabled = !locked,
 *     }).then(() => { Platform.loadingStop(); showMenu(); });
 *   </script>
 *
 * Rules the adapter enforces for you:
 *  - gameplayStart / gameplayStop never fire twice in a row and never during an ad (Poki review rule).
 *  - Ads mute + lock input only when the ad actually starts, and restore afterwards.
 *  - commercialBreak() / rewardedBreak() ALWAYS resolve, even with adblock, no fill, no SDK, or a hung SDK.
 *  - rewardedBreak() resolves true ONLY when the network reports the video was watched.
 *  - Nothing external is requested unless the platform is crazygames or poki (Poki blocks other requests).
 *  - Space / arrow / wheel page scrolling is suppressed so the portal page never jumps.
 *
 * Detection order: window.__GAME_PLATFORM__ → ?platform= query param → hostname → "web".
 * "mock" installs an in-page fake SDK (visible fake ad overlay) for local QA and automated tests.
 */
(function (global) {
  "use strict";

  var SDK_URLS = {
    crazygames: "https://sdk.crazygames.com/crazygames-sdk-v3.js",
    poki: "https://game-cdn.poki.com/scripts/v2/poki-sdk.js",
  };
  var AD_START_TIMEOUT_MS = 20000; // an ad that never starts must never freeze the game
  var AD_PLAY_TIMEOUT_MS = 180000; // once a video started, give it plenty of time to finish
  var INIT_TIMEOUT_MS = 8000;

  var memoryStore = {};
  var events = [];

  function now() {
    return typeof performance !== "undefined" && performance.now ? Math.round(performance.now()) : Date.now();
  }

  function record(ev, detail) {
    var e = { t: now(), ev: ev };
    if (detail !== undefined) e.detail = detail;
    events.push(e);
    if (events.length > 500) events.shift();
    if (Platform.debug) {
      try {
        console.log("[platform] " + ev + (detail !== undefined ? " " + JSON.stringify(detail) : ""));
      } catch (err) {
        /* ignore */
      }
    }
    var ls = listeners[ev];
    if (ls) for (var i = 0; i < ls.length; i++) {
      try { ls[i](detail); } catch (err) { /* listener errors must not break the game */ }
    }
    var all = listeners["*"];
    if (all) for (var j = 0; j < all.length; j++) {
      try { all[j](ev, detail); } catch (err) { /* ignore */ }
    }
  }

  var listeners = {};

  function withTimeout(promise, ms, fallbackValue) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        resolve(fallbackValue);
      }, ms);
      Promise.resolve(promise).then(
        function (v) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(v);
        },
        function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(fallbackValue);
        }
      );
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("failed to load " + src)); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  function queryParam(name) {
    try {
      var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(global.location.search);
      return m ? decodeURIComponent(m[1]) : null;
    } catch (err) {
      return null;
    }
  }

  function detectPlatform() {
    var forced = global.__GAME_PLATFORM__;
    var fromQuery = queryParam("platform");
    var pick = fromQuery || forced || "auto";
    if (pick !== "auto") return pick;
    var host = "";
    try { host = String(global.location.hostname || "").toLowerCase(); } catch (err) { /* ignore */ }
    var parts = host.split(".");
    if (parts.indexOf("crazygames") !== -1) return "crazygames";
    if (parts.indexOf("poki") !== -1 || parts.indexOf("poki-gdn") !== -1) return "poki";
    return "web";
  }

  function isTouchDevice() {
    try {
      return (
        "ontouchstart" in global ||
        (global.navigator && global.navigator.maxTouchPoints > 0) ||
        (global.matchMedia && global.matchMedia("(pointer: coarse)").matches)
      );
    } catch (err) {
      return false;
    }
  }

  function uaMobile() {
    try {
      return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(global.navigator.userAgent) ||
        (global.navigator.platform === "MacIntel" && global.navigator.maxTouchPoints > 1);
    } catch (err) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Mock SDK: a fake portal for QA. Shows a visible overlay for ~1.5 s per ad.
  // ---------------------------------------------------------------------------
  function createMock(opts) {
    var adblock = queryParam("mockAdblock") === "1";
    var fail = queryParam("mockAdFail") === "1";
    var hang = queryParam("mockAdHang") === "1"; // simulates an SDK that never answers
    var duration = Number(queryParam("mockAdMs") || 1500);
    function overlay(kind) {
      return new Promise(function (resolve) {
        var el = document.createElement("div");
        el.className = "platform-mock-ad";
        el.setAttribute("data-kind", kind);
        el.style.cssText =
          "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;" +
          "background:rgba(0,0,0,.86);color:#fff;font:700 24px/1.3 system-ui,sans-serif;text-align:center;letter-spacing:.06em";
        el.innerHTML = "<div>MOCK " + kind.toUpperCase() + " AD<br><small style='font-weight:400;font-size:14px'>the real portal shows a video here</small></div>";
        document.body.appendChild(el);
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
          resolve();
        }, duration);
      });
    }
    return {
      name: "mock",
      init: function () { return Promise.resolve(); },
      loadingStart: function () {},
      loadingStop: function () {},
      gameplayStart: function () {},
      gameplayStop: function () {},
      happyTime: function () {},
      reportProgress: function () {},
      setContext: function () {},
      clearContext: function () {},
      isMobile: function () { return uaMobile() || isTouchDevice(); },
      hasAdblock: function () { return Promise.resolve(adblock); },
      adsPossible: function () { return !adblock; },
      commercialBreak: function (hooks) {
        if (hang) return new Promise(function () {});
        if (adblock || fail) return Promise.resolve(false);
        hooks.started();
        return overlay("midgame").then(function () { hooks.finished(); return true; });
      },
      rewardedBreak: function (hooks) {
        if (hang) return new Promise(function () {});
        if (adblock || fail) return Promise.resolve(false);
        hooks.started();
        return overlay("rewarded").then(function () { hooks.finished(); return true; });
      },
      openLink: function (url) { try { global.open(url, "_blank", "noopener"); } catch (err) { /* ignore */ } },
      storage: null,
    };
  }

  // ---------------------------------------------------------------------------
  // CrazyGames v3
  // ---------------------------------------------------------------------------
  function createCrazyGames() {
    var sdk = null;
    var env = "disabled";
    var adsDisabled = false;
    function ready() { return !!sdk && env !== "disabled"; }
    return {
      name: "crazygames",
      init: function () {
        return loadScript(SDK_URLS.crazygames)
          .then(function () {
            sdk = global.CrazyGames && global.CrazyGames.SDK;
            if (!sdk) throw new Error("CrazyGames SDK missing after load");
            return sdk.init();
          })
          .then(function () {
            env = sdk.environment || "crazygames";
            record("sdk-ready", { platform: "crazygames", environment: env });
            if (!ready()) throw new Error("CrazyGames SDK disabled on this domain");
            try {
              // The portal's mute switch must win over in-game audio settings.
              var settings = sdk.game && sdk.game.settings;
              if (settings && settings.muteAudio) Platform._portalMute(true);
              if (sdk.game && sdk.game.addSettingsChangeListener) {
                sdk.game.addSettingsChangeListener(function (s) {
                  Platform._portalMute(!!(s && s.muteAudio));
                });
              }
            } catch (err) { /* optional */ }
          });
      },
      loadingStart: function () { if (ready()) try { sdk.game.loadingStart(); } catch (err) { /* ignore */ } },
      loadingStop: function () { if (ready()) try { sdk.game.loadingStop(); } catch (err) { /* ignore */ } },
      gameplayStart: function () { if (ready()) try { sdk.game.gameplayStart(); } catch (err) { /* ignore */ } },
      gameplayStop: function () { if (ready()) try { sdk.game.gameplayStop(); } catch (err) { /* ignore */ } },
      happyTime: function () { if (ready()) try { sdk.game.happytime(); } catch (err) { /* ignore */ } },
      reportProgress: function (pct) {
        if (ready() && sdk.game.reportGameCompletedPercentage) {
          try { sdk.game.reportGameCompletedPercentage(Math.max(0, Math.min(100, Math.round(pct)))); } catch (err) { /* ignore */ }
        }
      },
      setContext: function (ctx) { if (ready() && sdk.game.setGameContext) try { sdk.game.setGameContext(ctx); } catch (err) { /* ignore */ } },
      clearContext: function () { if (ready() && sdk.game.clearGameContext) try { sdk.game.clearGameContext(); } catch (err) { /* ignore */ } },
      isMobile: function () {
        try {
          var info = sdk && sdk.user && sdk.user.systemInfo;
          var type = info && info.device && info.device.type;
          if (type) return type === "mobile" || type === "tablet";
        } catch (err) { /* fall through */ }
        return uaMobile() || isTouchDevice();
      },
      hasAdblock: function () {
        if (!ready()) return Promise.resolve(false);
        return withTimeout(sdk.ad.hasAdblock(), 4000, false).then(function (v) { return !!v; });
      },
      adsPossible: function () { return ready() && !adsDisabled; },
      _request: function (kind, hooks) {
        if (!ready() || adsDisabled) return Promise.resolve(false);
        return new Promise(function (resolve) {
          var settled = false;
          var started = false;
          function finish(ok) {
            if (settled) return;
            settled = true;
            if (started) hooks.finished();
            resolve(ok);
          }
          try {
            sdk.ad.requestAd(kind, {
              adStarted: function () { started = true; hooks.started(); },
              adFinished: function () { finish(true); },
              adError: function (e) {
                var code = e && e.code;
                record("ad-error", { kind: kind, code: code || String(e) });
                if (code === "adsDisabledBasicLaunch") adsDisabled = true;
                finish(false);
              },
            });
          } catch (err) {
            finish(false);
          }
        });
      },
      commercialBreak: function (hooks) { return this._request("midgame", hooks); },
      rewardedBreak: function (hooks) { return this._request("rewarded", hooks); },
      openLink: function (url) { try { global.open(url, "_blank", "noopener"); } catch (err) { /* ignore */ } },
      get storage() {
        return ready() && sdk.data ? sdk.data : null;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Poki v2
  // ---------------------------------------------------------------------------
  function createPoki() {
    var sdk = null;
    var adblocked = false;
    function ready() { return !!sdk; }
    return {
      name: "poki",
      init: function () {
        return loadScript(SDK_URLS.poki).then(function () {
          sdk = global.PokiSDK;
          if (!sdk) throw new Error("PokiSDK missing after load");
          // PokiSDK.init rejects when ads are blocked; the game must still run.
          return withTimeout(sdk.init(), INIT_TIMEOUT_MS, "timeout").then(function (v) {
            if (v === "timeout") record("sdk-init-timeout", { platform: "poki" });
            record("sdk-ready", { platform: "poki" });
          }, function () {
            adblocked = true;
            record("sdk-ready", { platform: "poki", adblock: true });
          });
        });
      },
      loadingStart: function () {},
      loadingStop: function () { if (ready()) try { sdk.gameLoadingFinished(); } catch (err) { /* ignore */ } },
      gameplayStart: function () { if (ready()) try { sdk.gameplayStart(); } catch (err) { /* ignore */ } },
      gameplayStop: function () { if (ready()) try { sdk.gameplayStop(); } catch (err) { /* ignore */ } },
      happyTime: function () {},
      reportProgress: function () {},
      setContext: function () {},
      clearContext: function () {},
      isMobile: function () { return uaMobile() || isTouchDevice(); },
      hasAdblock: function () { return Promise.resolve(adblocked); },
      adsPossible: function () { return ready() && !adblocked; },
      commercialBreak: function (hooks) {
        if (!ready()) return Promise.resolve(false);
        var started = false;
        return Promise.resolve(sdk.commercialBreak(function () { started = true; hooks.started(); }))
          .then(function () { if (started) hooks.finished(); return started; },
                function () { if (started) hooks.finished(); return false; });
      },
      rewardedBreak: function (hooks) {
        if (!ready()) return Promise.resolve(false);
        var started = false;
        return Promise.resolve(sdk.rewardedBreak(function () { started = true; hooks.started(); }))
          .then(function (success) { if (started) hooks.finished(); return success === true; },
                function () { if (started) hooks.finished(); return false; });
      },
      openLink: function (url) {
        if (ready() && sdk.openExternalLink) { try { sdk.openExternalLink(url); return; } catch (err) { /* ignore */ } }
        try { global.open(url, "_blank", "noopener"); } catch (err) { /* ignore */ }
      },
      storage: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Plain web (itch, own site, local file) — no ads, nothing external.
  // ---------------------------------------------------------------------------
  function createWeb() {
    return {
      name: "web",
      init: function () { return Promise.resolve(); },
      loadingStart: function () {},
      loadingStop: function () {},
      gameplayStart: function () {},
      gameplayStop: function () {},
      happyTime: function () {},
      reportProgress: function () {},
      setContext: function () {},
      clearContext: function () {},
      isMobile: function () { return uaMobile() || isTouchDevice(); },
      hasAdblock: function () { return Promise.resolve(false); },
      adsPossible: function () { return false; },
      commercialBreak: function () { return Promise.resolve(false); },
      rewardedBreak: function () { return Promise.resolve(false); },
      openLink: function (url) { try { global.open(url, "_blank", "noopener"); } catch (err) { /* ignore */ } },
      storage: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Public facade
  // ---------------------------------------------------------------------------
  var impl = null;
  var gameplay = false;       // last state reported to the portal
  var inAd = false;
  var wasPlayingBeforeAd = false;
  var hooks = { onMute: null, onInputLock: null };
  var portalMuted = false;

  var Platform = {
    name: "web",
    ready: false,
    debug: false,
    events: events,

    /** Resolves once the portal SDK is ready (or the fallback is chosen). Never rejects. */
    init: function (options) {
      options = options || {};
      hooks.onMute = typeof options.onMute === "function" ? options.onMute : null;
      hooks.onInputLock = typeof options.onInputLock === "function" ? options.onInputLock : null;
      Platform.debug = !!options.debug || queryParam("platformDebug") === "1";
      if (options.preventPageScroll !== false) installPageGuards(!!options.blockContextMenu);

      var wanted = detectPlatform();
      if (wanted === "crazygames") impl = createCrazyGames();
      else if (wanted === "poki") impl = createPoki();
      else if (wanted === "mock") impl = createMock(options);
      else impl = createWeb();
      Platform.name = impl.name;
      record("init", { platform: impl.name });

      var initPromise = wanted === "poki"
        ? impl.init()                         // Poki has its own internal timeout above
        : withTimeout(impl.init(), INIT_TIMEOUT_MS, "timeout");

      return Promise.resolve(initPromise)
        .then(function (v) {
          if (v === "timeout") throw new Error("sdk init timeout");
        })
        .catch(function (err) {
          record("sdk-fallback", { platform: impl.name, reason: String(err && err.message || err) });
          impl = createWeb();
          Platform.name = "web";
        })
        .then(function () {
          Platform.ready = true;
          record("ready", { platform: Platform.name });
          if (options.loadingStart !== false) Platform.loadingStart();
        });
    },

    /** true on a portal where ads can actually show (hide rewarded buttons when false). */
    adsPossible: function () { return !!impl && impl.adsPossible(); },
    hasAdblock: function () { return impl ? impl.hasAdblock() : Promise.resolve(false); },
    isMobile: function () { return impl ? impl.isMobile() : (uaMobile() || isTouchDevice()); },
    isPortal: function () { return Platform.name === "crazygames" || Platform.name === "poki"; },

    loadingStart: function () { record("loadingStart"); if (impl) impl.loadingStart(); },
    loadingStop: function () { record("loadingStop"); if (impl) impl.loadingStop(); },

    /** Call on the player's first input of a round and on every resume. Idempotent. */
    gameplayStart: function () {
      if (inAd || gameplay) return false;
      gameplay = true;
      record("gameplayStart");
      if (impl) impl.gameplayStart();
      return true;
    },
    /** Call on pause, level end, game over, menu open. Idempotent. */
    gameplayStop: function () {
      if (inAd || !gameplay) return false;
      gameplay = false;
      record("gameplayStop");
      if (impl) impl.gameplayStop();
      return true;
    },
    isGameplay: function () { return gameplay; },
    inAd: function () { return inAd; },

    /** Interstitial at a natural break. Resolves when the game may continue. */
    commercialBreak: function () {
      if (inAd) return Promise.resolve(false);
      record("commercialBreak:request");
      return runAd("commercialBreak");
    },
    /** Opt-in rewarded video. Resolves true only when the reward was earned. */
    rewardedBreak: function () {
      if (inAd) return Promise.resolve(false);
      record("rewardedBreak:request");
      return runAd("rewardedBreak");
    },

    happyTime: function () { record("happyTime"); if (impl) impl.happyTime(); },
    reportProgress: function (pct) { record("reportProgress", pct); if (impl) impl.reportProgress(pct); },
    setContext: function (ctx) { if (impl) impl.setContext(ctx); },
    clearContext: function () { if (impl) impl.clearContext(); },
    openLink: function (url) { record("openLink", url); if (impl) impl.openLink(url); },

    on: function (ev, fn) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return function () {
        var ls = listeners[ev];
        if (!ls) return;
        var i = ls.indexOf(fn);
        if (i !== -1) ls.splice(i, 1);
      };
    },

    /** Persistent save slot: CrazyGames account sync when available, else localStorage, else memory. */
    storage: {
      getItem: function (key) {
        try { var s = impl && impl.storage; if (s) { var v = s.getItem(key); if (v !== undefined) return v; } } catch (err) { /* ignore */ }
        try { var l = global.localStorage.getItem(key); if (l !== null) return l; } catch (err) { /* private mode */ }
        return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
      },
      setItem: function (key, value) {
        value = String(value);
        memoryStore[key] = value;
        try { global.localStorage.setItem(key, value); } catch (err) { /* private mode / quota */ }
        try { var s = impl && impl.storage; if (s) s.setItem(key, value); } catch (err) { /* ignore */ }
      },
      removeItem: function (key) {
        delete memoryStore[key];
        try { global.localStorage.removeItem(key); } catch (err) { /* ignore */ }
        try { var s = impl && impl.storage; if (s) s.removeItem(key); } catch (err) { /* ignore */ }
      },
      getJSON: function (key, fallback) {
        try { var raw = Platform.storage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (err) { return fallback; }
      },
      setJSON: function (key, obj) { Platform.storage.setItem(key, JSON.stringify(obj)); },
    },

    _portalMute: function (muted) {
      portalMuted = muted;
      record("portalMute", muted);
      if (hooks.onMute) hooks.onMute(muted || inAd);
    },
    portalMuted: function () { return portalMuted; },
  };

  function runAd(kind) {
    inAd = true;
    wasPlayingBeforeAd = gameplay;
    if (gameplay) {
      // The portal must see the break; do it before the request, not while the ad plays.
      gameplay = false;
      record("gameplayStop");
      if (impl) impl.gameplayStop();
    }
    var started = false;
    var adHooks = {
      started: function () {
        if (started) return;
        started = true;
        record(kind + ":started");
        if (hooks.onMute) hooks.onMute(true);
        if (hooks.onInputLock) hooks.onInputLock(true);
      },
      finished: function () {
        record(kind + ":finished");
        if (hooks.onMute) hooks.onMute(portalMuted);
        if (hooks.onInputLock) hooks.onInputLock(false);
      },
    };
    var p;
    try {
      p = Promise.resolve(impl ? impl[kind](adHooks) : false);
    } catch (err) {
      p = Promise.resolve(false);
    }
    // Two-stage timeout: give up fast if no video ever starts, but never cut a playing video short.
    var guarded = new Promise(function (resolve) {
      var done = false;
      function settle(v) { if (done) return; done = true; resolve(v); }
      p.then(settle, function () { settle(false); });
      setTimeout(function () {
        if (done) return;
        if (!started) { record(kind + ":timeout-before-start"); settle(false); return; }
        setTimeout(function () { if (!done) { record(kind + ":timeout-during-play"); settle(false); } }, AD_PLAY_TIMEOUT_MS);
      }, AD_START_TIMEOUT_MS);
    });
    return guarded.then(function (result) {
      inAd = false;
      // Safety: if a started hook fired but finished never did, restore the game.
      if (hooks.onInputLock) hooks.onInputLock(false);
      if (hooks.onMute) hooks.onMute(portalMuted);
      record(kind + ":done", { result: result, resumeGameplay: wasPlayingBeforeAd });
      return result;
    });
  }

  var guardsInstalled = false;
  function installPageGuards(blockContextMenu) {
    if (guardsInstalled) return;
    guardsInstalled = true;
    try {
      global.addEventListener("keydown", function (e) {
        var k = e.key;
        var editing = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
        if (editing) return;
        if (k === " " || k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight" || k === "Spacebar") {
          e.preventDefault();
        }
      }, { passive: false });
      global.addEventListener("wheel", function (e) { e.preventDefault(); }, { passive: false });
      if (blockContextMenu) document.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    } catch (err) { /* ignore */ }
  }

  global.Platform = Platform;
  global.__platformEvents = events;
})(typeof window !== "undefined" ? window : this);
