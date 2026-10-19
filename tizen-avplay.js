/**
 * Tizen AVPlay Integration Layer for Rozcestník
 * Routes HLS/DASH streams through Samsung's native hardware decoder,
 * bypassing CORS restrictions and MPEG-TS browser limitations.
 *
 * Samsung AVPlay operates at the firmware level, outside the Chromium
 * sandbox. It natively decodes MPEG-TS, supports custom HTTP headers,
 * and does not enforce browser CORS policies.
 *
 * ES5-compatible (Chromium 76/85 on Tizen 6.0+)
 */
'use strict';

(function(global) {
  var LOG_PREFIX = '[TizenAVPlay]';
  var MAX_RETRIES = 3;
  var RETRY_DELAY_MS = 1500;

  // ── Internal State ──────────────────────────────────────────────────
  var _state = 'NONE';       // NONE, IDLE, READY, PLAYING, PAUSED
  var _currentUrl = null;
  var _currentOptions = null;
  var _retryCount = 0;
  var _objectEl = null;       // <object type="application/avplayer">
  var _containerEl = null;
  var _positionInterval = null;
  var _isFullscreen = false;
  var _overlayEl = null;

  // ── Helpers ─────────────────────────────────────────────────────────
  function log() {
    var args = [LOG_PREFIX];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    console.log.apply(console, args);
  }

  function warn() {
    var args = [LOG_PREFIX];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    console.warn.apply(console, args);
  }

  function err() {
    var args = [LOG_PREFIX];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    console.error.apply(console, args);
  }

  function safeCall(fn) {
    try { fn(); } catch (e) { err('Safe call error:', e.message || e); }
  }

  // ── Availability Detection ──────────────────────────────────────────
  function isAvailable() {
    return (typeof webapis !== 'undefined' &&
            webapis !== null &&
            typeof webapis.avplay !== 'undefined' &&
            webapis.avplay !== null &&
            typeof webapis.avplay.open === 'function');
  }

  // ── AVPlay Object Element Management ────────────────────────────────
  function createObjectElement(container) {
    // Remove any existing AVPlay object
    removeObjectElement();

    var obj = document.createElement('object');
    obj.id = 'tizen-avplay-obj';
    obj.setAttribute('type', 'application/avplayer');
    obj.style.cssText = [
      'position: absolute',
      'top: 0',
      'left: 0',
      'width: 100%',
      'height: 100%',
      'z-index: 1',
      'background: transparent !important',
      'pointer-events: none'
    ].join('; ');

    if (container) {
      var pos = window.getComputedStyle(container).position;
      if (pos === 'static' || pos === '') {
        container.style.position = 'relative';
      }
      container.style.backgroundColor = 'transparent';
      // Hide standard HTML5 video elements inside container to prevent blocking hardware plane
      var innerVideos = container.querySelectorAll('video');
      for (var v = 0; v < innerVideos.length; v++) {
        innerVideos[v].style.display = 'none';
      }
      container.appendChild(obj);
      _containerEl = container;
    } else {
      document.body.appendChild(obj);
      _containerEl = document.body;
    }

    _objectEl = obj;
    return obj;
  }

  function removeObjectElement() {
    if (_containerEl && _containerEl !== document.body) {
      try {
        _containerEl.style.backgroundColor = '';
        var innerVideos = _containerEl.querySelectorAll('video');
        for (var v = 0; v < innerVideos.length; v++) {
          innerVideos[v].style.display = '';
        }
      } catch (e) {}
    }
    if (_objectEl) {
      try {
        if (_objectEl.parentNode) {
          _objectEl.parentNode.removeChild(_objectEl);
        }
      } catch (e) {}
      _objectEl = null;
    }
  }

  // ── Overlay Management (fullscreen transparent overlay for AVPlay) ──
  function createOverlay() {
    removeOverlay();

    var overlay = document.createElement('div');
    overlay.id = 'tizen-avplay-overlay';
    overlay.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'width: 100vw',
      'height: 100vh',
      'background: transparent !important',
      'z-index: 2005',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'pointer-events: none'
    ].join('; ');

    // Create the object element inside overlay
    var obj = document.createElement('object');
    obj.id = 'tizen-avplay-obj';
    obj.setAttribute('type', 'application/avplayer');
    obj.style.cssText = [
      'width: 100%',
      'height: 100%',
      'background: transparent !important',
      'pointer-events: none'
    ].join('; ');

    overlay.appendChild(obj);
    document.body.appendChild(overlay);

    _overlayEl = overlay;
    _objectEl = obj;
    _isFullscreen = true;

    return obj;
  }

  function removeOverlay() {
    if (_overlayEl) {
      try {
        if (_overlayEl.parentNode) {
          _overlayEl.parentNode.removeChild(_overlayEl);
        }
      } catch (e) {}
      _overlayEl = null;
      _objectEl = null;
      _isFullscreen = false;
    }
  }

  // ── Display Rect Calculation ────────────────────────────────────────
  function calculateDisplayRect(container) {
    var winW = window.innerWidth || 1920;
    var winH = window.innerHeight || 1080;
    var scaleX = 1920 / winW;
    var scaleY = 1080 / winH;

    if (_isFullscreen || !container) {
      return {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080
      };
    }

    var rect = container.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080
      };
    }

    return {
      x: Math.round(rect.left * scaleX),
      y: Math.round(rect.top * scaleY),
      width: Math.round(rect.width * scaleX),
      height: Math.round(rect.height * scaleY)
    };
  }

  // ── HTTP Header Configuration ───────────────────────────────────────
  function configureHeaders(url) {
    if (!url || typeof url !== 'string') return;

    var lowerUrl = url.toLowerCase();

    // Desktop-like User-Agent to avoid Cloudflare bot detection
    safeCall(function() {
      webapis.avplay.setStreamingProperty(
        'USER_AGENT',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
    });

    // yasuoyone.org: Inject Origin + Referer
    if (lowerUrl.indexOf('yasuoyone.org') !== -1) {
      log('Configuring headers for yasuoyone.org');
      safeCall(function() {
        webapis.avplay.setStreamingProperty(
          'SET_CUSTOM_HEADER',
          JSON.stringify({
            'Referer': 'https://yasuoyone.org/',
            'Origin': 'https://yasuoyone.org'
          })
        );
      });
      return;
    }

    // CETIN / Mazana / aw-ucdn: Strip Origin/Referer (send none)
    if (lowerUrl.indexOf('cetin.cz') !== -1 ||
        lowerUrl.indexOf('mazana.tv') !== -1 ||
        lowerUrl.indexOf('aw-ucdn') !== -1) {
      log('Configuring headers for CETIN/Mazana (no referrer)');
      // AVPlay by default does not send Origin/Referer
      // so simply not setting them achieves the same as the Electron behavior
      return;
    }
  }

  // ── Adaptive Streaming Configuration ────────────────────────────────
  function configureAdaptiveStreaming(url) {
    if (!url || typeof url !== 'string') return;

    var lowerUrl = url.toLowerCase();
    var isHLS = lowerUrl.indexOf('.m3u8') !== -1;
    var isDASH = lowerUrl.indexOf('.mpd') !== -1 ||
                 lowerUrl.indexOf('aiv-cdn.net') !== -1 ||
                 lowerUrl.indexOf('pv-cdn.net') !== -1;

    safeCall(function() {
      if (isDASH) {
        webapis.avplay.setStreamingProperty(
          'ADAPTIVE_INFO',
          'BITRATES=100~20000|STARTBITRATE=HIGHEST|BUFFERING_TIME=5000'
        );
      } else if (isHLS) {
        webapis.avplay.setStreamingProperty(
          'ADAPTIVE_INFO',
          'BITRATES=100~20000|STARTBITRATE=HIGHEST|BUFFERING_TIME=4000'
        );
      }
    });

    // For live streams, try to minimize latency
    safeCall(function() {
      webapis.avplay.setStreamingProperty('LIVE_DURATION', '7000');
    });
  }

  // ── ClearKey DRM Configuration ──────────────────────────────────────
  function configureDRM(clearKeys) {
    if (!clearKeys || typeof clearKeys !== 'object') return;

    var keys = Object.keys(clearKeys);
    if (keys.length === 0) return;

    log('Configuring ClearKey DRM with', keys.length, 'key(s)');

    // AVPlay ClearKey DRM setup
    // Format: JSON object with key_id:key pairs
    try {
      var drmParam = {
        'DeleteLicenseAfterUse': true,
        'type': 'ClearKey',
        'keys': []
      };

      for (var i = 0; i < keys.length; i++) {
        var kid = keys[i].replace(/[^0-9a-fA-F]/g, '').toLowerCase();
        var key = clearKeys[keys[i]].replace(/[^0-9a-fA-F]/g, '').toLowerCase();
        if (kid.length >= 32 && key.length >= 32) {
          drmParam.keys.push({ 'kty': 'oct', 'kid': kid, 'k': key });
        }
      }

      if (drmParam.keys.length > 0) {
        webapis.avplay.setDrm('CLEARKEY', 'SetProperties', JSON.stringify(drmParam));
      }
    } catch (e) {
      warn('ClearKey DRM configuration failed (may not be supported on this model):', e.message || e);
      // ClearKey via AVPlay DRM may not be available on all models.
      // For CETIN/HLS streams without DRM this is expected and harmless.
    }
  }

  // ── Event Listener Setup ────────────────────────────────────────────
  function setupListener(options) {
    var opts = options || {};

    var listener = {
      onbufferingstart: function() {
        log('Buffering started');
        _state = 'READY';
        if (typeof opts.onBuffering === 'function') {
          opts.onBuffering('start', 0);
        }
      },

      onbufferingprogress: function(percent) {
        if (typeof opts.onBuffering === 'function') {
          opts.onBuffering('progress', percent);
        }
      },

      onbufferingcomplete: function() {
        log('Buffering complete');
        if (typeof opts.onBuffering === 'function') {
          opts.onBuffering('complete', 100);
        }
      },

      oncurrentplaytime: function(currentTime) {
        // currentTime is in milliseconds
        if (typeof opts.onTimeUpdate === 'function') {
          opts.onTimeUpdate(currentTime);
        }
      },

      onevent: function(eventType, eventData) {
        log('Event:', eventType, eventData);
        if (eventType === 'PLAYER_MSG_RESOLUTION_CHANGED') {
          // Resolution changed
        }
        if (eventType === 'PLAYER_MSG_BITRATE_CHANGE') {
          // Bitrate changed
        }
      },

      onstreamcompleted: function() {
        log('Stream completed');
        _state = 'IDLE';
        if (typeof opts.onComplete === 'function') {
          opts.onComplete();
        }
      },

      onerror: function(eventType) {
        err('Playback error:', eventType);
        _state = 'IDLE';

        // Retry logic
        if (_retryCount < MAX_RETRIES && _currentUrl) {
          _retryCount++;
          warn('Retrying playback (attempt ' + _retryCount + '/' + MAX_RETRIES + ')...');
          setTimeout(function() {
            if (_currentUrl) {
              playInternal(_currentUrl, _currentOptions);
            }
          }, RETRY_DELAY_MS);
        } else {
          if (typeof opts.onError === 'function') {
            opts.onError(eventType);
          }
        }
      },

      onsubtitlechange: function(duration, text, data3, data4) {
        // Subtitle data available
      }
    };

    try {
      webapis.avplay.setListener(listener);
    } catch (e) {
      err('Failed to set listener:', e.message || e);
    }
  }

  // ── Core Playback ───────────────────────────────────────────────────
  function playInternal(url, options) {
    var opts = options || {};

    // Safety: stop any current playback first
    stopInternal(true);

    _currentUrl = url;
    _currentOptions = opts;

    log('Opening stream:', url.substring(0, 80) + '...');

    try {
      // 1. Create the display element
      if (opts.containerEl) {
        createObjectElement(opts.containerEl);
      } else {
        createOverlay();
      }

      // 2. Open the URL
      webapis.avplay.open(url);
      _state = 'IDLE';

      // 3. Set display rect
      var displayRect = calculateDisplayRect(opts.containerEl || null);
      log('Display rect:', displayRect.x, displayRect.y, displayRect.width, displayRect.height);
      webapis.avplay.setDisplayRect(
        displayRect.x,
        displayRect.y,
        displayRect.width,
        displayRect.height
      );

      safeCall(function() {
        webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      });

      // 4. Configure HTTP headers (CORS bypass)
      configureHeaders(url);

      // 5. Configure adaptive streaming
      configureAdaptiveStreaming(url);

      // 6. Configure DRM if keys provided
      if (opts.clearKeys) {
        configureDRM(opts.clearKeys);
      }

      // 7. Set up event listeners
      setupListener(opts);

      // 8. Prepare and play
      webapis.avplay.prepareAsync(
        function onPrepareSuccess() {
          log('Prepare succeeded, starting playback');
          _state = 'READY';

          try {
            webapis.avplay.play();
            _state = 'PLAYING';
            _retryCount = 0; // Reset retry counter on success
            log('Playback started successfully');

            if (typeof opts.onPlaying === 'function') {
              opts.onPlaying();
            }

            // Start position tracking
            startPositionTracking(opts);
          } catch (playErr) {
            err('play() failed:', playErr.message || playErr);
            if (typeof opts.onError === 'function') {
              opts.onError('PLAY_FAILED');
            }
          }
        },
        function onPrepareError(error) {
          err('prepareAsync failed:', error ? (error.message || error) : 'unknown');
          _state = 'IDLE';

          // Retry logic
          if (_retryCount < MAX_RETRIES) {
            _retryCount++;
            warn('Prepare failed, retrying (attempt ' + _retryCount + '/' + MAX_RETRIES + ')...');
            safeCall(function() { webapis.avplay.close(); });
            setTimeout(function() {
              if (_currentUrl) {
                playInternal(_currentUrl, _currentOptions);
              }
            }, RETRY_DELAY_MS);
          } else {
            if (typeof opts.onError === 'function') {
              opts.onError('PREPARE_FAILED');
            }
          }
        }
      );

    } catch (e) {
      err('Failed to open stream:', e.message || e);
      _state = 'NONE';
      if (typeof opts.onError === 'function') {
        opts.onError('OPEN_FAILED: ' + (e.message || e));
      }
    }
  }

  // ── Position Tracking ───────────────────────────────────────────────
  function startPositionTracking(opts) {
    stopPositionTracking();
    _positionInterval = setInterval(function() {
      if (_state !== 'PLAYING' && _state !== 'PAUSED') {
        stopPositionTracking();
        return;
      }
      // Position is already reported via oncurrentplaytime listener
    }, 1000);
  }

  function stopPositionTracking() {
    if (_positionInterval) {
      clearInterval(_positionInterval);
      _positionInterval = null;
    }
  }

  // ── Stop / Cleanup ──────────────────────────────────────────────────
  function stopInternal(keepUrl) {
    stopPositionTracking();

    var avplayState = 'NONE';
    try {
      avplayState = webapis.avplay.getState();
    } catch (e) {}

    if (avplayState !== 'NONE' && avplayState !== 'IDLE') {
      safeCall(function() { webapis.avplay.stop(); });
    }
    if (avplayState !== 'NONE') {
      safeCall(function() { webapis.avplay.close(); });
    }

    _state = 'NONE';

    // Remove DOM elements
    removeOverlay();
    removeObjectElement();

    if (!keepUrl) {
      _currentUrl = null;
      _currentOptions = null;
      _retryCount = 0;
    }
  }

  // ── Public API ──────────────────────────────────────────────────────
  var TizenAVPlay = {
    /**
     * Check if Samsung AVPlay is available on this device
     * @returns {boolean}
     */
    isAvailable: isAvailable,

    /**
     * Play a stream URL through Samsung AVPlay (native HW decoder)
     * @param {string} url - Stream URL (.m3u8 or .mpd)
     * @param {Object} options
     * @param {HTMLElement} [options.containerEl] - Container element (null = fullscreen)
     * @param {Object} [options.clearKeys] - ClearKey DRM keys {kid: key}
     * @param {Object} [options.headers] - Custom HTTP headers
     * @param {Function} [options.onError] - Error callback(errorType)
     * @param {Function} [options.onBuffering] - Buffering callback(phase, percent)
     * @param {Function} [options.onPlaying] - Playback started callback
     * @param {Function} [options.onComplete] - Stream completed callback
     * @param {Function} [options.onTimeUpdate] - Time update callback(ms)
     */
    play: function(url, options) {
      if (!isAvailable()) {
        err('AVPlay is not available on this device');
        if (options && typeof options.onError === 'function') {
          options.onError('NOT_AVAILABLE');
        }
        return;
      }
      _retryCount = 0;
      playInternal(url, options || {});
    },

    /**
     * Stop playback and clean up
     */
    stop: function() {
      if (!isAvailable()) return;
      log('Stopping playback');
      stopInternal(false);
    },

    /**
     * Pause playback
     */
    pause: function() {
      if (!isAvailable()) return;
      if (_state === 'PLAYING') {
        safeCall(function() {
          webapis.avplay.pause();
          _state = 'PAUSED';
          log('Paused');
        });
      }
    },

    /**
     * Resume playback
     */
    resume: function() {
      if (!isAvailable()) return;
      if (_state === 'PAUSED') {
        safeCall(function() {
          webapis.avplay.play();
          _state = 'PLAYING';
          log('Resumed');
        });
      }
    },

    /**
     * Get current player state
     * @returns {string} NONE, IDLE, READY, PLAYING, PAUSED
     */
    getState: function() {
      if (!isAvailable()) return 'NONE';
      try {
        return webapis.avplay.getState();
      } catch (e) {
        return _state;
      }
    },

    /**
     * Update display rect (e.g., on resize)
     */
    setDisplayRect: function(x, y, w, h) {
      if (!isAvailable()) return;
      safeCall(function() {
        webapis.avplay.setDisplayRect(x, y, w, h);
      });
    },

    /**
     * Get stream duration in milliseconds
     * @returns {number}
     */
    getDuration: function() {
      if (!isAvailable()) return 0;
      try {
        return webapis.avplay.getDuration();
      } catch (e) {
        return 0;
      }
    },

    /**
     * Get current playback position in milliseconds
     * @returns {number}
     */
    getCurrentTime: function() {
      if (!isAvailable()) return 0;
      try {
        return webapis.avplay.getCurrentTime();
      } catch (e) {
        return 0;
      }
    },

    /**
     * Seek to position in milliseconds
     */
    seekTo: function(ms, successCb, errorCb) {
      if (!isAvailable()) return;
      if (_state === 'PLAYING' || _state === 'PAUSED') {
        safeCall(function() {
          webapis.avplay.seekTo(
            ms,
            function() {
              log('Seek complete to', ms, 'ms');
              if (typeof successCb === 'function') successCb();
            },
            function(e) {
              warn('Seek failed:', e);
              if (typeof errorCb === 'function') errorCb(e);
            }
          );
        });
      }
    },

    /**
     * Toggle play/pause
     */
    togglePlayPause: function() {
      if (_state === 'PLAYING') {
        this.pause();
      } else if (_state === 'PAUSED') {
        this.resume();
      }
    },

    /**
     * Check if currently playing
     * @returns {boolean}
     */
    isPlaying: function() {
      return _state === 'PLAYING';
    },

    /**
     * Get the currently playing URL
     * @returns {string|null}
     */
    getCurrentUrl: function() {
      return _currentUrl;
    },

    /**
     * Get available video tracks (qualities/bitrates)
     * @returns {Array<{index: number, width: number, height: number, bitrate: number, label: string}>}
     */
    getVideoTracks: function() {
      if (!isAvailable()) return [];
      try {
        var totalInfo = webapis.avplay.getTotalTrackInfo();
        if (!totalInfo || !totalInfo.length) return [];
        var videoTracks = [];
        for (var i = 0; i < totalInfo.length; i++) {
          var t = totalInfo[i];
          if (t && (t.type === 'VIDEO' || t.type === 'video')) {
            var extra = {};
            if (typeof t.extra_info === 'string') {
              try {
                extra = JSON.parse(t.extra_info);
              } catch (e) {
                var pairs = t.extra_info.split(/[;,]/);
                for (var p = 0; p < pairs.length; p++) {
                  var kv = pairs[p].split('=');
                  if (kv.length === 2) extra[kv[0].trim()] = kv[1].trim();
                }
              }
            } else if (typeof t.extra_info === 'object' && t.extra_info !== null) {
              extra = t.extra_info;
            }
            var w = parseInt(extra.Width || extra.width || 0, 10);
            var h = parseInt(extra.Height || extra.height || 0, 10);
            var br = parseInt(extra.Bit_rate || extra.bitrate || extra.Bitrate || 0, 10);
            var label = '';
            if (h > 0) {
              label = h + 'p';
              if (br > 0) label += ' (' + Math.round(br / 1000) + ' kbps)';
            } else if (br > 0) {
              label = Math.round(br / 1000) + ' kbps';
            } else {
              label = 'Stopa ' + (t.index !== undefined ? t.index : (i + 1));
            }
            videoTracks.push({
              index: t.index !== undefined ? t.index : i,
              width: w,
              height: h,
              bitrate: br,
              label: label
            });
          }
        }
        return videoTracks;
      } catch (err) {
        warn('Error fetching video tracks:', err);
        return [];
      }
    },

    /**
     * Set active video track
     * @param {number} trackIndex
     */
    setVideoTrack: function(trackIndex) {
      if (!isAvailable()) return;
      safeCall(function() {
        webapis.avplay.setSelectTrack('VIDEO', trackIndex);
        log('Selected video track:', trackIndex);
      });
    },

    /**
     * Get available audio tracks
     * @returns {Array<{index: number, language: string, label: string}>}
     */
    getAudioTracks: function() {
      if (!isAvailable()) return [];
      try {
        var totalInfo = webapis.avplay.getTotalTrackInfo();
        if (!totalInfo || !totalInfo.length) return [];
        var audioTracks = [];
        for (var i = 0; i < totalInfo.length; i++) {
          var t = totalInfo[i];
          if (t && (t.type === 'AUDIO' || t.type === 'audio')) {
            var extra = {};
            if (typeof t.extra_info === 'string') {
              try { extra = JSON.parse(t.extra_info); } catch (e) {}
            } else if (typeof t.extra_info === 'object' && t.extra_info !== null) {
              extra = t.extra_info;
            }
            var lang = extra.Language || extra.language || extra.Four_CC || ('Audio ' + (t.index !== undefined ? t.index : (i + 1)));
            audioTracks.push({
              index: t.index !== undefined ? t.index : i,
              language: lang,
              label: lang
            });
          }
        }
        return audioTracks;
      } catch (err) {
        return [];
      }
    },

    /**
     * Set active audio track
     * @param {number} trackIndex
     */
    setAudioTrack: function(trackIndex) {
      if (!isAvailable()) return;
      safeCall(function() {
        webapis.avplay.setSelectTrack('AUDIO', trackIndex);
        log('Selected audio track:', trackIndex);
      });
    }
  };

  // ── Expose Globally ─────────────────────────────────────────────────
  global.TizenAVPlay = TizenAVPlay;

  // Log availability on load
  if (typeof document !== 'undefined') {
    var checkAvail = function() {
      if (isAvailable()) {
        log('Samsung AVPlay API detected and available');
        log('CORS-free native HLS/DASH playback enabled');
      } else {
        log('AVPlay not available (non-Samsung or missing API)');
        log('Will fall back to Shaka Player');
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', checkAvail);
    } else {
      checkAvail();
    }
  }

})(typeof window !== 'undefined' ? window : this);
