/**
 * Tizen TV Adapter for Rozcestník (Samsung Smart TV / Tizen 6.0+)
 * Handles Cloudflare Turnstile bypass, native environment flags,
 * no-referrer fetch/XHR patching, Samsung remote Back button (10009),
 * TV input device key registration, and spatial navigation.
 */
'use strict';

(function initTizenAdapter() {
  // ── 1. Bypass Cloudflare Turnstile Gate ──────────────────────────────
  var BYPASS_TOKEN = 'native-app-bypass-' + Date.now();

  try { sessionStorage.setItem('cf_clearance_token', BYPASS_TOKEN); } catch(e){}
  try { sessionStorage.setItem('cf_turnstile_verified', 'true'); } catch(e){}
  try { localStorage.setItem('cf_clearance_token', BYPASS_TOKEN); } catch(e){}
  try { localStorage.setItem('cf_turnstile_verified', 'true'); } catch(e){}
  window.__cf_clearance_token = BYPASS_TOKEN;

  function markVerified() {
    if (document.documentElement) {
      document.documentElement.classList.add('cf-verified');
    }
    if (document.body) {
      document.body.classList.remove('turnstile-locked');
    }
    var gate = document.getElementById('turnstile-gate');
    if (gate) {
      gate.style.setProperty('display', 'none', 'important');
    }
  }

  markVerified();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markVerified);
  }

  // Pre-resolve global turnstile promise
  if (window.__turnstileResolve) {
    try { window.__turnstileResolve(BYPASS_TOKEN); } catch(e){}
  } else {
    var _origResolve = null;
    try {
      Object.defineProperty(window, '__turnstileResolve', {
        get: function() { return _origResolve; },
        set: function(fn) {
          _origResolve = fn;
          if (typeof fn === 'function') {
            try { fn(BYPASS_TOKEN); } catch(e){}
          }
        },
        configurable: true
      });
    } catch(e){}
  }

  window.onTurnstileSuccess = function(token) {
    try { sessionStorage.setItem('cf_turnstile_verified', 'true'); } catch(e){}
    try { localStorage.setItem('cf_turnstile_verified', 'true'); } catch(e){}
    markVerified();
  };

  // ── 2. Native App & TV Flags ─────────────────────────────────────────
  window.__NATIVE_APP__ = true;
  window.__NATIVE_PLATFORM__ = 'tizen';
  window.__NATIVE_ANDROID__ = false;
  window.isTvPlatform = true;

  // ── 3. TizenBrew Local Proxy Integration & Network Enforcement ─────────
  var PROXY_PORT = 3007;
  var PROXY_HOST = 'http://127.0.0.1:' + PROXY_PORT;
  window.__TB_PROXY_PORT__ = PROXY_PORT;
  window.__TB_PROXY_HOST__ = PROXY_HOST;
  window.__TB_PROXY_ACTIVE__ = false;

  function pingProxy() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', PROXY_HOST + '/ping', true);
      xhr.timeout = 2000;
      xhr.onload = function() {
        if (xhr.status === 200) {
          if (!window.__TB_PROXY_ACTIVE__) {
            console.log('[TizenAdapter] Local streaming proxy detected on ' + PROXY_HOST);
          }
          window.__TB_PROXY_ACTIVE__ = true;
        }
      };
      xhr.onerror = function() {
        window.__TB_PROXY_ACTIVE__ = false;
      };
      xhr.ontimeout = function() {
        window.__TB_PROXY_ACTIVE__ = false;
      };
      xhr.send();
    } catch (e) {}
  }
  pingProxy();
  setInterval(pingProxy, 5000);

  function wrapWithProxy(u) {
    if (!u || typeof u !== 'string') return u;
    if (u.indexOf(PROXY_HOST) === 0) return u;
    if (/^https?:\/\//i.test(u)) {
      return PROXY_HOST + '/proxy?url=' + encodeURIComponent(u);
    }
    return u;
  }
  window.__wrapWithProxy = wrapWithProxy;

  // Global Shaka Player proxy interceptor
  function hookShakaProxy() {
    if (typeof window !== 'undefined' && window.shaka && window.shaka.Player && !window.shaka.Player._tbProxyHooked) {
      window.shaka.Player._tbProxyHooked = true;
      var origLoad = window.shaka.Player.prototype.load;
      window.shaka.Player.prototype.load = function(assetUri, startTime, mimeType) {
        var u = assetUri;
        if (typeof u === 'string' && window.__TB_PROXY_ACTIVE__ && /^https?:\/\//i.test(u)) {
          u = wrapWithProxy(u);
        }
        return origLoad.call(this, u, startTime, mimeType);
      };

      var origAttach = window.shaka.Player.prototype.attach;
      window.shaka.Player.prototype.attach = function(mediaEl, opt_init) {
        var res = origAttach.call(this, mediaEl, opt_init);
        try {
          var netEngine = this.getNetworkingEngine && this.getNetworkingEngine();
          if (netEngine && !this._tbProxyFilterRegistered) {
            this._tbProxyFilterRegistered = true;
            netEngine.registerRequestFilter(function(type, request) {
              if (window.__TB_PROXY_ACTIVE__ && request && request.uris && request.uris.length) {
                for (var i = 0; i < request.uris.length; i++) {
                  var curUri = request.uris[i];
                  if (typeof curUri === 'string' && /^https?:\/\//i.test(curUri)) {
                    if (curUri.indexOf(PROXY_HOST) !== 0) {
                      request.uris[i] = wrapWithProxy(curUri);
                    }
                  }
                }
              }
            });
          }
        } catch (e) {}
        return res;
      };
    }
  }
  hookShakaProxy();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookShakaProxy);
  }
  window.addEventListener('load', hookShakaProxy);
  setInterval(hookShakaProxy, 1000);

  if (typeof window.fetch === 'function' && !window.fetch._nativeAppPatched) {
    var _origFetch = window.fetch;
    window.fetch = function(input, init) {
      var urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      var isYasuoyone = typeof urlStr === 'string' && (
        urlStr.includes('.yasuoyone.org') || urlStr.includes('//yasuoyone.org')
      );
      init = Object.assign({}, init || {});
      if (!isYasuoyone) {
        init.referrerPolicy = 'no-referrer';
        init.referrer = '';
      } else {
        init.referrerPolicy = 'origin';
        init.referrer = 'https://yasuoyone.org/';
      }

      if (window.__TB_PROXY_ACTIVE__ && typeof urlStr === 'string' && /^https?:\/\//i.test(urlStr)) {
        if (urlStr.indexOf(PROXY_HOST) !== 0 && !urlStr.includes(location.hostname)) {
          var proxied = wrapWithProxy(urlStr);
          if (typeof input === 'string') {
            input = proxied;
          } else if (input && typeof Request !== 'undefined' && input instanceof Request) {
            input = new Request(proxied, init);
          }
        }
      }
      return _origFetch.call(this, input, init);
    };
    window.fetch._nativeAppPatched = true;
  }

  if (typeof XMLHttpRequest !== 'undefined' && !XMLHttpRequest.prototype._nativeAppPatched) {
    var _origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      var isYasuoyone = typeof url === 'string' && (
        url.includes('.yasuoyone.org') || url.includes('//yasuoyone.org')
      );
      if (!isYasuoyone) {
        try { this.referrerPolicy = 'no-referrer'; } catch (e) {}
      }
      if (window.__TB_PROXY_ACTIVE__ && typeof url === 'string' && /^https?:\/\//i.test(url)) {
        if (url.indexOf(PROXY_HOST) !== 0 && !url.includes(location.hostname)) {
          url = wrapWithProxy(url);
        }
      }
      return _origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype._nativeAppPatched = true;
  }

  // ── 4. Tizen TV Input Device Key Registration ────────────────────────
  function registerTizenKeys() {
    if (typeof tizen !== 'undefined' && tizen.tvinputdevice && typeof tizen.tvinputdevice.registerKey === 'function') {
      var tvKeys = [
        'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
        'MediaFastForward', 'MediaRewind',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
      ];
      tvKeys.forEach(function(k) {
        try {
          tizen.tvinputdevice.registerKey(k);
        } catch (e) {}
      });
    }
  }
  registerTizenKeys();
  window.addEventListener('load', registerTizenKeys);

  // ── 5. Inject High-Visibility Focus CSS for TV Remotes ────────────────
  function injectFocusStyles() {
    var styleId = 'tizen-tv-focus-style';
    if (document.getElementById(styleId)) return;
    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      ':focus, :focus-visible, .tv-focused {',
      '  outline: none !important;',
      '  border-color: #ffc629 !important;',
      '  box-shadow: 0 0 25px rgba(255, 198, 41, 0.8), 0 0 0 3px #ffc629 !important;',
      '  transform: scale(1.04) !important;',
      '  transition: transform 0.15s ease, box-shadow 0.15s ease !important;',
      '  z-index: 100 !important;',
      '}',
      '.channel-card:focus, .sports-card:focus, .channel-item:focus, .ppv-card:focus, .quick-card:focus, .lib-card:focus, .tool-card:focus {',
      '  border-color: #ffc629 !important;',
      '  box-shadow: 0 0 30px rgba(255, 198, 41, 0.85), 0 0 0 3px #ffc629 !important;',
      '  transform: translateY(-4px) scale(1.03) !important;',
      '}',
      'body { user-select: none; -webkit-user-select: none; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  if (document.head || document.documentElement) {
    injectFocusStyles();
  } else {
    document.addEventListener('DOMContentLoaded', injectFocusStyles);
  }

  // ── TV On-Screen Diagnostic HUD ───────────────────────────────────────
  window.tvDiag = function(key, val, color) {
    try {
      var box = document.getElementById('tv-diag-box');
      if (!box) {
        box = document.createElement('div');
        box.id = 'tv-diag-box';
        box.style.cssText = 'position:fixed;bottom:25px;left:25px;right:25px;background:rgba(12,12,18,0.96);border:2px solid #ffc629;border-radius:12px;padding:12px 20px;font-family:monospace;font-size:14px;color:#fff;z-index:99999999;box-shadow:0 10px 40px rgba(0,0,0,0.95);pointer-events:none;display:block;';
        box.innerHTML = '<div style="font-weight:900;color:#ffc629;font-size:15px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">' +
          '<span><i class="fa-solid fa-satellite-dish" style="margin-right:8px;color:#ffc629;"></i>ROZCESTNÍK TV DIAGNOSTIKA</span>' +
          '<span id="tv-diag-hw-badge" style="font-size:11px;padding:3px 8px;border-radius:4px;background:#222;color:#aaa;">AVPlay HW: testuji...</span>' +
          '</div>' +
          '<div id="tv-diag-proxy" style="margin-bottom:3px;color:#ddd;font-size:13px;">Proxy: ' + (window.__TB_PROXY_ACTIVE__ ? '<span style="color:#00ff88;font-weight:bold;">AKTIVNÍ (127.0.0.1:3007)</span>' : '<span style="color:#ff6666;font-weight:bold;">NEBĚŽÍ (přímé spojení)</span>') + '</div>' +
          '<div id="tv-diag-engine" style="margin-bottom:3px;color:#ddd;font-size:13px;">Přehrávač: -</div>' +
          '<div id="tv-diag-url" style="margin-bottom:3px;word-break:break-all;color:#999;font-size:12px;">URL: -</div>' +
          '<div id="tv-diag-status" style="font-weight:bold;color:#ffc629;font-size:14px;margin-top:4px;">Stav: Připraveno</div>';
        (document.body || document.documentElement).appendChild(box);

        var badge = document.getElementById('tv-diag-hw-badge');
        if (badge) {
          var hasAvplay = typeof webapis !== 'undefined' && webapis.avplay;
          badge.innerHTML = hasAvplay ? '<span style="color:#00ff88;">AVPlay HW: PODPOROVÁNO</span>' : '<span style="color:#ffbb00;">AVPlay HW: NEDOSTUPNÉ</span>';
        }
      }
      box.style.display = 'block';

      if (key === 'proxy') {
        var pEl = document.getElementById('tv-diag-proxy');
        if (pEl) pEl.innerHTML = 'Proxy: ' + val;
      } else if (key === 'engine') {
        var eEl = document.getElementById('tv-diag-engine');
        if (eEl) eEl.innerHTML = 'Přehrávač: ' + val;
      } else if (key === 'url') {
        var uEl = document.getElementById('tv-diag-url');
        if (uEl) uEl.innerHTML = 'URL: ' + val;
      } else if (key === 'status') {
        var sEl = document.getElementById('tv-diag-status');
        if (sEl) {
          sEl.innerHTML = 'Stav: ' + val;
          if (color) sEl.style.color = color;
        }
      }
    } catch (e) {}
  };

  window.hideTvDiag = function() {
    try {
      var box = document.getElementById('tv-diag-box');
      if (box) box.style.display = 'none';
    } catch (e) {}
  };

  // ── Samsung Hardware AVPlay API Integration (webapis.avplay) ─────────
  window.TizenAVPlay = {
    isAvailable: function() {
      return typeof webapis !== 'undefined' && webapis.avplay && typeof webapis.avplay.open === 'function';
    },
    active: false,
    currentUrl: null,
    play: function(streamUrl, options) {
      options = options || {};
      var self = this;
      if (!this.isAvailable()) {
        if (options.onError) options.onError(new Error("webapis.avplay not supported"));
        return false;
      }

      this.stop();

      try {
        window.tvDiag('engine', '<span style="color:#00e5ff;font-weight:bold;">Samsung Hardware AVPlay čip</span>');
        window.tvDiag('url', streamUrl);
        window.tvDiag('status', 'Otevírám AVPlay...', '#ffc629');

        webapis.avplay.open(streamUrl);
        this.currentUrl = streamUrl;
        this.active = true;

        var screenW = window.innerWidth || 1920;
        var screenH = window.innerHeight || 1080;
        try {
          webapis.avplay.setDisplayRect(0, 0, screenW, screenH);
        } catch (eRect) {}

        try {
          webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
        } catch (eMethod) {}

        // Set User-Agent to standard Chrome desktop to bypass Cloudflare bot filtering
        try {
          webapis.avplay.setStreamingProperty("USER_AGENT", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        } catch (eProp) {}

        // Make web video transparent so hardware plane beneath is visible
        var videoEl = document.getElementById('video');
        if (videoEl) videoEl.style.opacity = '0';
        var shaC = document.getElementById('sha-c');
        if (shaC) shaC.style.backgroundColor = 'transparent';

        var listener = {
          onbufferingstart: function() {
            window.tvDiag('status', 'Buffering (stahuji data ze serveru)...', '#ffc629');
          },
          onbufferingprogress: function(percent) {
            window.tvDiag('status', 'Buffering: ' + percent + '%', '#ffc629');
          },
          onbufferingcomplete: function() {
            window.tvDiag('status', 'Přehrává se (Samsung AVPlay OK)', '#00ff88');
          },
          oncurrentplaytime: function(time) {},
          onerror: function(eventType) {
            console.error('[AVPlay] Hardware error:', eventType);
            window.tvDiag('status', 'CHYBA AVPlay Hardware: ' + eventType, '#ff4444');
            self.active = false;
            if (options.onError) options.onError(eventType);
          }
        };
        webapis.avplay.setListener(listener);

        webapis.avplay.prepareAsync(function() {
          try {
            webapis.avplay.play();
            window.tvDiag('status', 'Přehrává se (Samsung AVPlay OK)', '#00ff88');
            if (options.onSuccess) options.onSuccess();
          } catch (ePlay) {
            console.error('[AVPlay] Play exception:', ePlay);
            window.tvDiag('status', 'CHYBA při spuštění AVPlay: ' + ePlay.message, '#ff4444');
            self.active = false;
            if (options.onError) options.onError(ePlay);
          }
        }, function(ePrep) {
          console.error('[AVPlay] Prepare error:', ePrep);
          window.tvDiag('status', 'CHYBA AVPlay Prepare: ' + JSON.stringify(ePrep), '#ff4444');
          self.active = false;
          if (options.onError) options.onError(ePrep);
        });

        return true;
      } catch (err) {
        console.error('[AVPlay] Open exception:', err);
        window.tvDiag('status', 'CHYBA AVPlay Open: ' + err.message, '#ff4444');
        self.active = false;
        if (options.onError) options.onError(err);
        return false;
      }
    },
    stop: function() {
      if (this.isAvailable()) {
        try {
          var state = webapis.avplay.getState();
          if (state !== 'NONE' && state !== 'IDLE') {
            webapis.avplay.stop();
          }
          webapis.avplay.close();
        } catch (e) {}
      }
      this.active = false;
      this.currentUrl = null;
      var videoEl = document.getElementById('video');
      if (videoEl) videoEl.style.opacity = '1';
    }
  };

  // ── 6. Universal Samsung TV Back / Return Key Handler (10009) ─────────
  function handleSamsungBackKey(e) {
    if (window.TizenAVPlay && window.TizenAVPlay.active) {
      window.TizenAVPlay.stop();
      if (typeof window.hideTvDiag === 'function') window.hideTvDiag();
    }
    // Check TV Settings Modal
    var sm = document.getElementById('tv-settings-modal');
    if (sm && (sm.classList.contains('active') || sm.style.display === 'flex' || sm.style.display === 'block')) {
      if (e && e.preventDefault) e.preventDefault();
      if (typeof window.closeTvSettings === 'function') {
        window.closeTvSettings();
      } else {
        sm.classList.remove('active');
        sm.style.display = 'none';
      }
      return true;
    }

    // Check Shaka / App Player
    if (window.playerOpen && typeof window.clP === 'function') {
      if (e && e.preventDefault) e.preventDefault();
      window.clP();
      return true;
    }

    // Check dedicated video overlay in tv/index.html
    var playerOverlay = document.getElementById('playerOverlay');
    if (playerOverlay && playerOverlay.classList.contains('active')) {
      if (e && e.preventDefault) e.preventDefault();
      if (typeof window.closePlayer === 'function') {
        window.closePlayer();
      } else {
        playerOverlay.classList.remove('active');
      }
      return true;
    }

    // Check player-view in epg.html
    var playerView = document.getElementById('player-view');
    if (playerView && !playerView.classList.contains('hidden')) {
      if (e && e.preventDefault) e.preventDefault();
      var exitBtn = document.getElementById('c-exit-btn');
      if (exitBtn) exitBtn.click();
      return true;
    }

    // Check player modal in sports.html
    var playerModal = document.getElementById('player-modal');
    if (playerModal && playerModal.classList.contains('active')) {
      if (e && e.preventDefault) e.preventDefault();
      var btnClosePlayer = document.getElementById('btn-close-player');
      if (btnClosePlayer) {
        btnClosePlayer.click();
      } else {
        playerModal.classList.remove('active');
      }
      return true;
    }

    // Check focus-modal (in 4net.html & ultraplayer.html)
    var focusModal = document.getElementById('focus-modal');
    if (focusModal && (focusModal.style.display === 'flex' || focusModal.style.display === 'block')) {
      if (e && e.preventDefault) e.preventDefault();
      if (typeof window.closeFocus === 'function') {
        window.closeFocus();
      } else {
        focusModal.style.display = 'none';
      }
      return true;
    }

    // Check active modals / popups
    var activeModal = document.querySelector('.player-modal-backdrop.active, .info-modal-backdrop.active, .pp-overlay.active, #apk-overlay.active, #pp-overlay.active, .modal-overlay.active, .tv-settings-overlay.active');
    if (activeModal) {
      if (e && e.preventDefault) e.preventDefault();
      activeModal.classList.remove('active');
      if (activeModal.style) activeModal.style.display = 'none';
      return true;
    }

    // Check subpage navigation (if in tv/*.html or alt/*.html)
    var isSubPage = window.location.pathname.includes('/tv/') ||
                    window.location.pathname.includes('/alt/') ||
                    (window.location.href.includes('/tv/') || window.location.href.includes('/alt/'));

    if (isSubPage) {
      if (e && e.preventDefault) e.preventDefault();
      if (typeof window.goBackToRozcestnik === 'function') {
        window.goBackToRozcestnik(e);
      } else if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = '../index.html';
      }
      return true;
    }

    // On main index.html: return to 'home' view if in another view
    if (window.curV && window.curV !== 'home') {
      if (e && e.preventDefault) e.preventDefault();
      if (typeof window.swV === 'function') {
        window.swV('home', true);
        return true;
      }
    }

    // If on main page home view: cleanly exit app on Samsung Tizen TV
    if (typeof tizen !== 'undefined' && tizen.application) {
      if (e && e.preventDefault) e.preventDefault();
      try {
        tizen.application.getCurrentApplication().exit();
        return true;
      } catch (err) {
        console.warn('Could not exit Tizen application:', err);
      }
    }

    return false;
  }

  // Intercept keydown for Samsung TV Back key (10009), Escape (27), Android Back (4), XF86Back
  window.addEventListener('keydown', function(e) {
    var code = e.keyCode || e.which;
    if (code === 10009 || code === 27 || code === 4 || e.key === 'Escape' || e.key === 'XF86Back') {
      if (handleSamsungBackKey(e)) {
        e.stopPropagation();
      }
    }
  }, true);

  // Intercept Tizen hardware key event
  window.addEventListener('tizenhwkey', function(e) {
    if (e.keyName === 'back') {
      handleSamsungBackKey(e);
    }
  });

  // ── 7. Spatial D-Pad Navigation Engine Fallback ────────────────────────
  // Provides smooth 2D arrow navigation on any page missing its own engine
  function getFocusableElements() {
    var modal = document.querySelector('.player-modal-backdrop.active, .info-modal-backdrop.active, .tv-settings-overlay.active, .pp-overlay.active, #apk-overlay.active, #playerOverlay.active');
    var container = modal || document.body;
    var selector = 'button:not([disabled]), [tabindex="0"], a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), .channel-card, .sports-card, .channel-item, .cat-pill, .nav-item, .ppv-card, .quick-card, .lib-card, .tool-card, .src-btn, .tv-opt-btn, .tv-tab-btn, .btn-ctrl, .top-back-btn';
    var nodes = Array.from(container.querySelectorAll(selector));
    return nodes.filter(function(el) {
      if (el.disabled || el.tabIndex === -1) return false;
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function runSpatialNavigation(direction) {
    var focusables = getFocusableElements();
    if (!focusables.length) return;

    var cur = document.activeElement;
    if (!cur || !focusables.includes(cur)) {
      focusables[0].focus();
      return;
    }

    var cRect = cur.getBoundingClientRect();
    var cCenter = { x: cRect.left + cRect.width / 2, y: cRect.top + cRect.height / 2 };

    var bestEl = null;
    var bestDist = Infinity;

    focusables.forEach(function(target) {
      if (target === cur) return;
      var tRect = target.getBoundingClientRect();
      var tCenter = { x: tRect.left + tRect.width / 2, y: tRect.top + tRect.height / 2 };
      var dx = tCenter.x - cCenter.x;
      var dy = tCenter.y - cCenter.y;

      var isValidDir = false;
      var score = Infinity;

      if (direction === 'ArrowRight' && dx > 8) {
        isValidDir = true;
        score = dx + Math.abs(dy) * 2.2;
      } else if (direction === 'ArrowLeft' && dx < -8) {
        isValidDir = true;
        score = Math.abs(dx) + Math.abs(dy) * 2.2;
      } else if (direction === 'ArrowDown' && dy > 8) {
        isValidDir = true;
        score = dy + Math.abs(dx) * 1.8;
      } else if (direction === 'ArrowUp' && dy < -8) {
        isValidDir = true;
        score = Math.abs(dy) + Math.abs(dx) * 1.8;
      }

      if (isValidDir && score < bestDist) {
        bestDist = score;
        bestEl = target;
      }
    });

    if (bestEl) {
      bestEl.focus();
      if (typeof bestEl.scrollIntoView === 'function') {
        bestEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }

  // For pages like sports.html or mazana.html that lack internal spatial nav:
  window.addEventListener('keydown', function(e) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;

    // Do not steer if typing in text input
    var tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if ((tag === 'input' && document.activeElement.type === 'text') || tag === 'textarea') return;

    // Check if the page has its own spatial nav handler already
    // (index.html defines window.handleSpatialNavigation)
    if (typeof window.handleSpatialNavigation === 'function') return;

    e.preventDefault();
    runSpatialNavigation(e.key);
  });

  // Handle TV Enter / OK button on focusable elements
  window.addEventListener('keydown', function(e) {
    var code = e.keyCode || e.which;
    if (code === 13 || code === 23 || code === 66 || code === 160 || e.key === 'Enter') {
      var act = document.activeElement;
      if (act && act !== document.body) {
        var isClickable = act.tagName === 'BUTTON' || act.tagName === 'A' ||
                          act.hasAttribute('onclick') || act.classList.contains('channel-card') ||
                          act.classList.contains('sports-card') || act.classList.contains('channel-item') ||
                          act.classList.contains('cat-pill') || act.classList.contains('ppv-card') ||
                          act.classList.contains('quick-card') || act.classList.contains('lib-card');
        if (isClickable && typeof act.click === 'function') {
          // If element has inner button (like card with open button), trigger that
          var innerBtn = act.querySelector('button');
          if (innerBtn) {
            e.preventDefault();
            innerBtn.click();
          }
        }
      }
    }
  });

  // Initial focus on TV startup so user sees cursor immediately
  window.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
      if (!document.activeElement || document.activeElement === document.body) {
        var focusables = getFocusableElements();
        if (focusables.length) {
          focusables[0].focus();
        }
      }
    }, 400);
  });

  console.log('Tizen TV Adapter initialized successfully.');
})();
