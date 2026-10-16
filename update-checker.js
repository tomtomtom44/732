/**
 * Rozcestník App Update Checker v1.0.2
 * Checks for new releases on yasuoyone.org and notifies native app users.
 * Does not show false-positive notifications when already on the latest version.
 */
(function() {
  'use strict';

  var CURRENT_VERSION = "1.3.0";
  var VERSION_ENDPOINTS = [
    "https://yasuoyone.org/version.json",
    "https://rozc.pages.dev/version.json"
  ];

  var cachedLocalVersion = null;

  function isNativeApp() {
    return !!(
      (window.AndroidNative && typeof window.AndroidNative.getAppVersion === "function") ||
      window.__NATIVE_APP__ ||
      window.__NATIVE_ANDROID__ ||
      (window.electronAPI && window.electronAPI.isNativeApp) ||
      (window.__NATIVE_PLATFORM__ && window.__NATIVE_PLATFORM__ !== "web")
    );
  }

  function getPlatform() {
    // 1. Android TV
    if (window.__NATIVE_PLATFORM__ === "android-tv" || location.pathname.includes("/tv/") || /Android.*(TV|LargeScreen|SmartTV)/i.test(navigator.userAgent)) {
      return "android_tv";
    }
    // 2. Android Phone
    if (window.__NATIVE_PLATFORM__ === "android-phone" || (window.__NATIVE_ANDROID__ && !location.pathname.includes("/tv/")) || (/Android/i.test(navigator.userAgent) && !/TV/i.test(navigator.userAgent))) {
      return "android";
    }
    // 3. macOS (Apple Silicon M1-M4 & Intel)
    var isMac = (window.electronAPI && window.electronAPI.platform === "darwin") ||
                window.__NATIVE_PLATFORM__ === "macos_arm64" ||
                window.__NATIVE_PLATFORM__ === "macos_x64" ||
                /Macintosh|Mac OS X|MacIntel/i.test(navigator.userAgent) ||
                (typeof navigator !== "undefined" && (navigator.platform === "MacIntel" || (navigator.userAgentData && navigator.userAgentData.platform === "macOS")));
    if (isMac) {
      var isArm = (window.electronAPI && window.electronAPI.arch === "arm64") ||
                  window.__NATIVE_PLATFORM__ === "macos_arm64" ||
                  /arm64|aarch64/i.test(navigator.userAgent) ||
                  (navigator.userAgentData && navigator.userAgentData.architecture === "arm");

      if (!isArm && typeof document !== "undefined") {
        try {
          var canvas = document.createElement("canvas");
          var gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
          if (gl) {
            var dbg = gl.getExtension("WEBGL_debug_renderer_info");
            if (dbg) {
              var rend = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "";
              if (/Apple/i.test(rend) && !/Intel/i.test(rend)) {
                isArm = true;
              }
            }
          }
        } catch(e) {}
      }

      var isIntel = (window.electronAPI && window.electronAPI.arch === "x64") ||
                    window.__NATIVE_PLATFORM__ === "macos_x64";
      return (!isIntel || isArm) ? "macos_arm64" : "macos_x64";
    }
    // 4. Linux
    var isLinux = (window.electronAPI && window.electronAPI.platform === "linux") ||
                  window.__NATIVE_PLATFORM__ === "linux_x64" ||
                  /Linux/i.test(navigator.userAgent);
    if (isLinux) {
      return "linux_x64";
    }
    // 5. Windows
    return "windows";
  }

  function normalizeSemver(v) {
    if (!v) return [0, 0, 0];
    var s = String(v).trim().replace(/^[^\d]*/, "");
    var parts = s.split(".");
    return [
      parseInt(parts[0], 10) || 0,
      parseInt(parts[1], 10) || 0,
      parseInt(parts[2], 10) || 0
    ];
  }

  function isNewer(remote, local) {
    if (!remote || !local) return false;
    var r = normalizeSemver(remote);
    var l = normalizeSemver(local);
    if (r[0] > l[0]) return true;
    if (r[0] < l[0]) return false;
    if (r[1] > l[1]) return true;
    if (r[1] < l[1]) return false;
    if (r[2] > l[2]) return true;
    return false;
  }

  async function resolveLocalVersion() {
    if (cachedLocalVersion) return cachedLocalVersion;

    // 1. Check AndroidNative bridge
    try {
      if (window.AndroidNative && typeof window.AndroidNative.getAppVersion === "function") {
        var v = window.AndroidNative.getAppVersion();
        if (v && v.trim()) {
          cachedLocalVersion = v.trim();
          return cachedLocalVersion;
        }
      }
    } catch(e) {}

    // 2. Check Electron bridge
    try {
      if (window.electronAPI && window.electronAPI.appVersion) {
        cachedLocalVersion = String(window.electronAPI.appVersion).trim();
        return cachedLocalVersion;
      }
    } catch(e) {}

    // 3. Check window global __APP_VERSION__
    if (window.__APP_VERSION__ && String(window.__APP_VERSION__).trim()) {
      cachedLocalVersion = String(window.__APP_VERSION__).trim();
      return cachedLocalVersion;
    }

    // 4. Try reading bundled local version.json
    try {
      var localResp = await fetch("version.json", { cache: "no-cache" });
      if (localResp.ok) {
        var localJson = await localResp.json();
        var platform = getPlatform();
        var platVer = localJson.platforms && localJson.platforms[platform] && localJson.platforms[platform].version;
        cachedLocalVersion = platVer || localJson.version || CURRENT_VERSION;
        return cachedLocalVersion;
      }
    } catch(e) {}

    cachedLocalVersion = CURRENT_VERSION;
    return cachedLocalVersion;
  }

  function showToastMessage(msg, isSuccess) {
    var existingToast = document.querySelector(".update-toast-notice");
    if (existingToast && existingToast.parentNode) existingToast.parentNode.removeChild(existingToast);

    var toast = document.createElement("div");
    toast.className = "update-toast-notice";
    toast.style.cssText = [
      "position: fixed",
      "bottom: 40px",
      "left: 50%",
      "transform: translateX(-50%)",
      "background: rgba(14, 16, 22, 0.95)",
      "backdrop-filter: blur(16px)",
      "-webkit-backdrop-filter: blur(16px)",
      "border: 1px solid " + (isSuccess ? "rgba(74, 222, 128, 0.5)" : "rgba(255, 198, 41, 0.5)"),
      "color: " + (isSuccess ? "#4ade80" : "#f5f5f0"),
      "padding: 10px 22px",
      "border-radius: 999px",
      "font-size: 0.84rem",
      "font-weight: 600",
      "font-family: Outfit, -apple-system, sans-serif",
      "box-shadow: 0 10px 30px rgba(0,0,0,0.7), 0 0 16px " + (isSuccess ? "rgba(74, 222, 128, 0.2)" : "rgba(255, 198, 41, 0.2)"),
      "z-index: 999999",
      "pointer-events: none",
      "animation: updateToastIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both"
    ].join(";");
    toast.textContent = msg;

    if (!document.getElementById("update-toast-style")) {
      var styleEl = document.createElement("style");
      styleEl.id = "update-toast-style";
      styleEl.textContent = "@keyframes updateToastIn{from{opacity:0;transform:translate3d(-50%,20px,0) scale(0.95)}to{opacity:1;transform:translate3d(-50%,0,0) scale(1)}}";
      document.head.appendChild(styleEl);
    }

    document.body.appendChild(toast);
    setTimeout(function() {
      toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
      toast.style.opacity = "0";
      toast.style.transform = "translate3d(-50%, 20px, 0) scale(0.95)";
      setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3000);
  }

  
  function showInAppUpdateModal(dlUrl, newVer, notes) {
    var existingModal = document.getElementById("inapp-update-modal-backdrop");
    if (existingModal) existingModal.remove();

    var styleId = "inapp-update-modal-styles";
    if (!document.getElementById(styleId)) {
      var styleEl = document.createElement("style");
      styleEl.id = styleId;
      styleEl.textContent = [
        "@keyframes updModalFadeIn{from{opacity:0}to{opacity:1}}",
        "@keyframes updModalPopIn{from{opacity:0;transform:scale(0.92) translateY(20px)}to{opacity:1;transform:scale(1) translateY(0)}}",
        "@keyframes updBarShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}",
        "#inapp-update-modal-backdrop{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.82);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:20px;animation:updModalFadeIn 0.3s ease both}",
        "#inapp-update-modal-box{background:#111319;border:1px solid rgba(255,198,41,0.35);box-shadow:0 25px 60px rgba(0,0,0,0.9),0 0 40px rgba(255,198,41,0.18);border-radius:20px;max-width:500px;width:100%;padding:28px;color:#f5f5f0;font-family:Outfit,-apple-system,sans-serif;animation:updModalPopIn 0.35s cubic-bezier(0.16,1,0.3,1) both;position:relative}",
        "#inapp-update-modal-box .upd-head{display:flex;align-items:center;gap:14px;margin-bottom:18px}",
        "#inapp-update-modal-box .upd-icon-box{width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,rgba(255,198,41,0.25),rgba(245,158,11,0.15));border:1px solid rgba(255,198,41,0.5);display:flex;align-items:center;justify-content:center;color:#ffc629;font-size:1.5rem;flex-shrink:0}",
        "#inapp-update-modal-box .upd-title{font-size:1.25rem;font-weight:800;color:#fff;margin:0;line-height:1.2}",
        "#inapp-update-modal-box .upd-ver-tag{display:inline-block;margin-top:4px;background:rgba(255,198,41,0.15);border:1px solid rgba(255,198,41,0.4);color:#ffc629;font-size:0.75rem;padding:2px 8px;border-radius:6px;font-weight:700}",
        "#inapp-update-modal-box .upd-notes-box{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px 14px;font-size:0.85rem;color:#c0c0be;line-height:1.45;margin-bottom:20px;max-height:120px;overflow-y:auto}",
        "#inapp-update-modal-box .upd-status-lbl{font-size:0.9rem;font-weight:700;color:#fff;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}",
        "#inapp-update-modal-box .upd-pct{color:#ffc629;font-family:monospace;font-size:0.95rem}",
        "#inapp-update-modal-box .upd-track{background:rgba(255,255,255,0.08);border-radius:999px;height:12px;overflow:hidden;position:relative;margin-bottom:8px;border:1px solid rgba(255,255,255,0.05)}",
        "#inapp-update-modal-box .upd-fill{height:100%;width:0%;background:linear-gradient(90deg,#ffc629,#f59e0b,#fbbf24);border-radius:999px;transition:width 0.25s ease;background-size:200% 100%}",
        "#inapp-update-modal-box .upd-fill.active{animation:updBarShimmer 2s linear infinite}",
        "#inapp-update-modal-box .upd-details{font-size:0.78rem;color:#888;display:flex;justify-content:space-between;margin-bottom:22px}",
        "#inapp-update-modal-box .upd-actions{display:flex;gap:10px;justify-content:flex-end}",
        "#inapp-update-modal-box .upd-btn-main{background:linear-gradient(135deg,#ffc629,#f59e0b);color:#0a0a0a;border:none;border-radius:10px;padding:11px 22px;font-weight:800;font-size:0.9rem;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all 0.2s ease;box-shadow:0 4px 16px rgba(255,198,41,0.3)}",
        "#inapp-update-modal-box .upd-btn-main:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(255,198,41,0.45)}",
        "#inapp-update-modal-box .upd-btn-cancel{background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);color:#bbb;border-radius:10px;padding:11px 18px;font-weight:600;font-size:0.9rem;cursor:pointer;transition:all 0.2s}",
        "#inapp-update-modal-box .upd-btn-cancel:hover{background:rgba(255,255,255,0.12);color:#fff}"
      ].join("\n");
      document.head.appendChild(styleEl);
    }

    var backdrop = document.createElement("div");
    backdrop.id = "inapp-update-modal-backdrop";
    backdrop.innerHTML = [
      '<div id="inapp-update-modal-box">',
        '<div class="upd-head">',
          '<div class="upd-icon-box">',
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
          '</div>',
          '<div>',
            '<h3 class="upd-title">Aktualizace Rozcestník</h3>',
            '<span class="upd-ver-tag">Nová verze v' + newVer + '</span>',
          '</div>',
        '</div>',
        '<div class="upd-notes-box">' + notes + '</div>',
        '<div class="upd-status-lbl">',
          '<span id="inapp-status-text">Připraveno ke stažení a instalaci</span>',
          '<span class="upd-pct" id="inapp-status-pct">0%</span>',
        '</div>',
        '<div class="upd-track">',
          '<div class="upd-fill" id="inapp-progress-fill"></div>',
        '</div>',
        '<div class="upd-details">',
          '<span id="inapp-details-left">Automatické stažení a rozbalení</span>',
          '<span id="inapp-details-right">~80 MB</span>',
        '</div>',
        '<div class="upd-actions" id="inapp-modal-actions">',
          '<button class="upd-btn-cancel" id="inapp-btn-cancel">Zavřít</button>',
          '<button class="upd-btn-main" id="inapp-btn-start">',
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
            '<span>Spustit aktualizaci</span>',
          '</button>',
        '</div>',
      '</div>'
    ].join("");

    document.body.appendChild(backdrop);

    var cancelBtn = document.getElementById("inapp-btn-cancel");
    var startBtn = document.getElementById("inapp-btn-start");
    var statusText = document.getElementById("inapp-status-text");
    var statusPct = document.getElementById("inapp-status-pct");
    var progressFill = document.getElementById("inapp-progress-fill");
    var detailsLeft = document.getElementById("inapp-details-left");

    cancelBtn.onclick = function() {
      backdrop.remove();
    };

    startBtn.onclick = function() {
      startBtn.disabled = true;
      startBtn.style.opacity = "0.5";
      cancelBtn.style.display = "none";
      progressFill.classList.add("active");
      statusText.textContent = "Zahajuji stahování aktualizace...";

      if (window.electronAPI && typeof window.electronAPI.onUpdateProgress === "function") {
        window.electronAPI.onUpdateProgress(function(data) {
          if (data.stage === "downloading") {
            var pct = data.percent || 0;
            progressFill.style.width = pct + "%";
            statusPct.textContent = pct + "%";
            statusText.textContent = "Stahování aktualizace...";
            detailsLeft.textContent = (data.receivedMb || "0") + " MB z " + (data.totalMb || "80") + " MB";
          } else if (data.stage === "extracting") {
            progressFill.style.width = "100%";
            statusPct.textContent = "100%";
            statusText.textContent = "Rozbalování instalačního balíčku (unzip)...";
            detailsLeft.textContent = "Příprava instalátoru pro spuštění";
          } else if (data.stage === "launching") {
            progressFill.style.width = "100%";
            statusText.textContent = "Spouštění instalátoru...";
            detailsLeft.textContent = "Aplikace se nyní ukončí a provede aktualizaci";
          } else if (data.stage === "error") {
            progressFill.style.background = "#ef4444";
            statusText.textContent = "Chyba při aktualizaci";
            statusPct.textContent = "!";
            detailsLeft.textContent = data.message || "Stahování selhalo";
            cancelBtn.style.display = "inline-block";
            cancelBtn.textContent = "Zavřít";
            startBtn.disabled = false;
            startBtn.style.opacity = "1";
            startBtn.innerHTML = '<span>Stáhnout ručně v prohlížeči</span>';
            startBtn.onclick = function() {
              window.open(dlUrl, "_blank");
            };
          }
        });
      }

      window.electronAPI.startInAppUpdate({ downloadUrl: dlUrl, version: newVer }).then(function(res) {
        if (!res || !res.success) {
          progressFill.style.background = "#ef4444";
          statusText.textContent = "Chyba při aktualizaci";
          detailsLeft.textContent = (res && res.error) ? res.error : "Neznámá chyba";
          cancelBtn.style.display = "inline-block";
          cancelBtn.textContent = "Zavřít";
          startBtn.disabled = false;
          startBtn.style.opacity = "1";
          startBtn.innerHTML = '<span>Stáhnout ručně v prohlížeči</span>';
          startBtn.onclick = function() {
            window.open(dlUrl, "_blank");
          };
        }
      }).catch(function(err) {
        progressFill.style.background = "#ef4444";
        statusText.textContent = "Chyba při spuštění";
        detailsLeft.textContent = err.message;
        cancelBtn.style.display = "inline-block";
      });
    };
  }

  function showUpdateNotification(info, platformKey, localVer, ignoreSnooze) {
    var platformData = (info.platforms && info.platforms[platformKey]) || {};
    var newVer = platformData.version || info.version || CURRENT_VERSION;

    // Strict Double Check: never show if remote is not strictly newer
    if (!isNewer(newVer, localVer)) {
      console.log("[Rozcestnik Update] Up to date (local: " + localVer + ", remote: " + newVer + ")");
      return;
    }

    var dlUrl = platformData.downloadUrl || "https://yasuoyone.org";
    var notes = platformData.releaseNotes || info.releaseNotes || "Nová verze přináší opravy a vylepšení.";
    window._latestUpdateInfo = { dlUrl: dlUrl, newVer: newVer, notes: notes };

    // Check snooze unless manually triggered
    var snoozeKey = "snooze_update_" + newVer;
    if (!ignoreSnooze) {
      try {
        var snoozed = localStorage.getItem(snoozeKey);
        if (snoozed && Date.now() < parseInt(snoozed, 10)) {
          return;
        }
      } catch(e) {}
    }

    var existing = document.getElementById("app-update-banner");
    if (existing) return;

    var styleId = "update-banner-styles";
    if (!document.getElementById(styleId)) {
      var styleEl = document.createElement("style");
      styleEl.id = styleId;
      styleEl.textContent = [
        "@keyframes updateBannerIn{from{opacity:0;transform:translate3d(0,-30px,0) scale(0.96)}to{opacity:1;transform:translate3d(0,0,0) scale(1)}}",
        "#app-update-banner{position:fixed;top:18px;left:18px;right:18px;max-width:560px;margin:0 auto;z-index:999999;background:rgba(15,16,22,0.96);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,198,41,0.45);border-radius:16px;box-shadow:0 18px 45px rgba(0,0,0,0.85),0 0 30px rgba(255,198,41,0.22);padding:14px 18px;display:flex;align-items:center;gap:14px;color:#f5f5f0;font-family:Outfit,-apple-system,BlinkMacSystemFont,sans-serif;animation:updateBannerIn 0.4s cubic-bezier(0.16,1,0.3,1) both}",
        "#app-update-banner .upd-icon{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,rgba(255,198,41,0.25),rgba(255,159,0,0.15));border:1px solid rgba(255,198,41,0.5);display:flex;align-items:center;justify-content:center;color:#ffc629;font-size:1.3rem;flex-shrink:0;box-shadow:0 0 14px rgba(255,198,41,0.2)}",
        "#app-update-banner .upd-title-row{display:flex;align-items:center;gap:8px;font-weight:800;font-size:0.95rem;color:#fff}",
        "#app-update-banner .upd-pill{background:rgba(255,198,41,0.18);border:1px solid rgba(255,198,41,0.4);color:#ffc629;font-size:0.68rem;padding:2px 7px;border-radius:6px;font-weight:800;letter-spacing:0.5px}",
        "#app-update-banner .upd-notes{font-size:0.78rem;color:#a0a09e;margin-top:3px;line-height:1.35;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        "#app-update-banner .upd-btn-dl{background:linear-gradient(135deg,#ffc629,#f59e0b);color:#0a0a0a;font-weight:800;font-size:0.82rem;padding:9px 16px;border-radius:9px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;transition:all 0.2s ease;box-shadow:0 4px 14px rgba(255,198,41,0.3);border:none;cursor:pointer}",
        "#app-update-banner .upd-btn-dl:hover,#app-update-banner .upd-btn-dl:focus{transform:translateY(-1px);box-shadow:0 6px 18px rgba(255,198,41,0.45);outline:none}",
        "#app-update-banner .upd-btn-close{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#aaa;width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:0.95rem;display:flex;align-items:center;justify-content:center;transition:all 0.2s}",
        "#app-update-banner .upd-btn-close:hover,#app-update-banner .upd-btn-close:focus{background:rgba(255,255,255,0.12);color:#fff;outline:none}",
        "@media(max-width:540px){#app-update-banner{flex-wrap:wrap;padding:12px 14px;gap:10px}#app-update-banner .upd-actions{width:100%;display:flex;gap:8px;margin-top:2px}#app-update-banner .upd-btn-dl{flex:1;justify-content:center}}"
      ].join("\n");
      document.head.appendChild(styleEl);
    }

    var banner = document.createElement("div");
    banner.id = "app-update-banner";

    banner.innerHTML = [
      '<div class="upd-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>',
      '<div style="flex:1;min-width:0;">',
        '<div class="upd-title-row">',
          '<span>Nová verze v' + newVer + '</span>',
          '<span class="upd-pill">v' + localVer + ' → v' + newVer + '</span>',
        '</div>',
        '<div class="upd-notes" title="' + notes + '">' + notes + '</div>',
      '</div>',
      '<div class="upd-actions" style="display:flex;align-items:center;gap:8px;flex-shrink:0;">',
        '<a href="' + dlUrl + '" target="_blank" rel="noopener noreferrer" class="upd-btn-dl" id="btn-update-download" tabindex="0">',
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
          '<span>Aktualizovat</span>',
        '</a>',
        '<button class="upd-btn-close" id="btn-update-dismiss" title="Připomenout později" tabindex="0">✕</button>',
      '</div>'
    ].join('');

    document.body.appendChild(banner);

    // Update sidebar navigation elements if present
    var navBadge = document.getElementById("nav-update-badge");
    if (navBadge) {
      navBadge.style.display = "inline-block";
      navBadge.textContent = "v" + newVer;
    }
    var navText = document.getElementById("nav-update-text");
    if (navText) {
      navText.textContent = "Aktualizovat";
      navText.style.color = "#ffc629";
    }
    var navIco = document.getElementById("nav-update-icon");
    if (navIco) {
      navIco.style.color = "#ffc629";
    }

    // Download handler
    var dlBtn = document.getElementById("btn-update-download");
    if (dlBtn) {
      dlBtn.addEventListener("click", function(e) {
        var plat = getPlatform();
        if (plat === "windows" && window.electronAPI && typeof window.electronAPI.startInAppUpdate === "function") {
          e.preventDefault();
          showInAppUpdateModal(dlUrl, newVer, notes);
          return false;
        }
        if (plat.startsWith("macos_") || plat.startsWith("linux_")) {
          e.preventDefault();
          var finalDlUrl = dlUrl;
          if (finalDlUrl.toLowerCase().endsWith(".exe")) {
            finalDlUrl = plat.startsWith("macos_")
              ? "https://r2.yasuoyone.org/Rozcestnik-macOS-arm64.tar.gz"
              : "https://r2.yasuoyone.org/Rozcestnik-Linux-x64.tar.gz";
          }
          if (window.electronAPI && typeof window.electronAPI.openExternal === "function") {
            window.electronAPI.openExternal(finalDlUrl);
          } else {
            window.open(finalDlUrl, "_blank");
          }
          showToastMessage("Zahájeno stahování aktualizace pro " + (plat.startsWith("macos_") ? "macOS" : "Linux"), true);
          return false;
        }
        if (window.AndroidNative && typeof window.AndroidNative.openExternal === "function") {
          e.preventDefault();
          window.AndroidNative.openExternal(dlUrl);
          return false;
        }
        if (/Android/i.test(navigator.userAgent)) {
          window.location.href = dlUrl;
        }
      });
    }

    // Dismiss handler (snoozes for 24h)
    var dismissBtn = document.getElementById("btn-update-dismiss");
    if (dismissBtn) {
      dismissBtn.onclick = function() {
        try {
          localStorage.setItem(snoozeKey, String(Date.now() + 24 * 3600 * 1000));
        } catch(e) {}
        banner.style.transition = "all 0.3s cubic-bezier(0.16,1,0.3,1)";
        banner.style.opacity = "0";
        banner.style.transform = "translate3d(0,-24px,0) scale(0.95)";
        setTimeout(function() {
          if (banner.parentNode) banner.parentNode.removeChild(banner);
        }, 300);
      };
    }
  }

  // One-time important notice (e.g. domain move) driven by version.json "notice"
  function showImportantNotice(notice, platform) {
    if (!notice || !notice.id || !notice.message) return;
    if (notice.platforms && notice.platforms.indexOf(platform) === -1) return;
    var seenKey = "notice_seen_" + notice.id;
    try {
      if (localStorage.getItem(seenKey)) return;
    } catch(e) {}
    if (document.getElementById("important-notice-backdrop")) return;

    var backdrop = document.createElement("div");
    backdrop.id = "important-notice-backdrop";
    backdrop.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Outfit,-apple-system,sans-serif";

    var box = document.createElement("div");
    box.style.cssText = "background:#111319;border:1px solid rgba(255,198,41,0.45);border-radius:18px;max-width:460px;width:100%;padding:24px;color:#f5f5f0;box-shadow:0 25px 60px rgba(0,0,0,0.9)";

    var title = document.createElement("h3");
    title.style.cssText = "margin:0 0 12px;font-size:1.2rem;font-weight:800;color:#ffc629";
    title.textContent = notice.title || "Důležité upozornění";

    var msg = document.createElement("p");
    msg.style.cssText = "margin:0 0 20px;font-size:0.92rem;line-height:1.5;color:#d0d0ce;white-space:pre-line";
    msg.textContent = notice.message;

    var actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap";

    function close() {
      try { localStorage.setItem(seenKey, String(Date.now())); } catch(e) {}
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    var okBtn = document.createElement("button");
    okBtn.style.cssText = "background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#ddd;border-radius:10px;padding:10px 18px;font-weight:600;font-size:0.9rem;cursor:pointer";
    okBtn.textContent = notice.closeText || "Rozumím";
    okBtn.onclick = close;
    actions.appendChild(okBtn);

    if (notice.buttonUrl) {
      var linkBtn = document.createElement("button");
      linkBtn.style.cssText = "background:linear-gradient(135deg,#ffc629,#f59e0b);color:#0a0a0a;border:none;border-radius:10px;padding:10px 18px;font-weight:800;font-size:0.9rem;cursor:pointer";
      linkBtn.textContent = notice.buttonText || "Otevřít";
      linkBtn.onclick = function() {
        if (window.AndroidNative && typeof window.AndroidNative.openExternal === "function") {
          window.AndroidNative.openExternal(notice.buttonUrl);
        } else if (window.electronAPI && typeof window.electronAPI.openExternal === "function") {
          window.electronAPI.openExternal(notice.buttonUrl);
        } else {
          window.open(notice.buttonUrl, "_blank");
        }
        close();
      };
      actions.appendChild(linkBtn);
    }

    box.appendChild(title);
    box.appendChild(msg);
    box.appendChild(actions);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
  }

  async function checkVersion(interactive) {
    var platform = getPlatform();
    var localVer = await resolveLocalVersion();

    console.log("[Rozcestnik Update] Checking updates. Local version:", localVer, "Platform:", platform, "Native:", isNativeApp());

    // In regular web browsers, do not auto-popup update notifications unless interactive
    if (!interactive && !isNativeApp()) {
      return;
    }

    var found = false;
    for (var i = 0; i < VERSION_ENDPOINTS.length; i++) {
      try {
        var url = VERSION_ENDPOINTS[i] + "?_t=" + Date.now();
        var resp = await fetch(url, { cache: "no-cache" });
        if (resp.ok) {
          var data = await resp.json();
          if (isNativeApp()) showImportantNotice(data.notice, platform);
          var platformData = (data.platforms && data.platforms[platform]) || {};
          var remoteVer = platformData.version || data.version;

          if (remoteVer && isNewer(remoteVer, localVer)) {
            showUpdateNotification(data, platform, localVer, !!interactive);
            found = true;
            return;
          } else {
            found = true;
            if (interactive) {
              showToastMessage("✓ Aplikace je aktuální (v" + localVer + ")", true);
            }
            return;
          }
        }
      } catch(e) {
        console.warn("[Rozcestnik Update] Endpoint error:", VERSION_ENDPOINTS[i], e);
      }
    }

    if (!found && interactive) {
      showToastMessage("Nelze ověřit aktualizace (zkontrolujte připojení)", false);
    }
  }

  function initVersionBadge() {
    resolveLocalVersion().then(function(ver) {
      var sideTag = document.getElementById("sidebar-version-tag");
      if (sideTag) {
        sideTag.textContent = "v" + ver;
        sideTag.onclick = function() { checkVersion(true); };
      }
      var navBtn = document.getElementById("nav-update-btn");
      if (navBtn) {
        navBtn.title = "Verze v" + ver + " — Zkontrolovat aktualizace";
        navBtn.onclick = function() {
          var plat = getPlatform();
          if (plat === "windows" && window._latestUpdateInfo && window.electronAPI && typeof window.electronAPI.startInAppUpdate === "function") {
            showInAppUpdateModal(window._latestUpdateInfo.dlUrl, window._latestUpdateInfo.newVer, window._latestUpdateInfo.notes);
          } else {
            checkVersion(true);
          }
        };
      }

      var el = document.getElementById("app-version-display");
      if (!el) {
        var footer = document.querySelector(".privacy-footer") || document.querySelector("footer");
        if (footer) {
          el = document.createElement("div");
          el.id = "app-version-display";
          el.style.cssText = "margin-top:10px;font-size:0.75rem;color:#777;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;";
          el.innerHTML = '<span style="opacity:0.8;">Verze ' + ver + '</span> • <span style="color:#ffc629;text-decoration:underline;">Zkontrolovat aktualizace</span>';
          el.onclick = function() { checkVersion(true); };
          footer.appendChild(el);
        }
      } else {
        el.onclick = function() { checkVersion(true); };
      }
    });
  }

  // Initial check (only in browser environment)
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function() {
        setTimeout(function() { checkVersion(false); initVersionBadge(); }, 2500);
      });
    } else {
      setTimeout(function() { checkVersion(false); initVersionBadge(); }, 2500);
    }

    // Periodic check every 4 hours
    setInterval(function() { checkVersion(false); }, 4 * 3600 * 1000);
  }

  if (typeof window !== "undefined") {
    window.checkAppUpdates = checkVersion;
    window.__APP_VERSION__ = CURRENT_VERSION;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      isNewer: isNewer,
      normalizeSemver: normalizeSemver,
      getPlatform: getPlatform,
      resolveLocalVersion: resolveLocalVersion,
      isNativeApp: isNativeApp
    };
  }
})();
