/**
 * popup.js
 * Main controller for Timestamp Converter Chrome Extension.
 *
 * Architecture:
 *   - Module imports for all feature modules
 *   - Tab management system
 *   - Converter panel controller
 *   - Live clock controller
 *   - Batch converter controller
 *   - Utilities panel controller (Diff, Generator, Epoch Explorer)
 *   - Format Studio controller
 *   - Clipboard intelligence controller
 *   - History management
 *   - Theme & language controllers
 *   - Global keyboard shortcuts
 *   - Toast notification system
 *
 * All DOM interactions are centralised here.
 * Modules remain pure (no DOM access).
 */

import i18n               from "./modules/i18n.js";
import { parse, INPUT_TYPES } from "./modules/parser.js";
import {
  getAllFormats,
  getDevPresets,
  getFormatPresets,
  formatPattern,
  formatIntl,
  toRFC2822,
  toISO8601,
}                          from "./modules/formatter.js";
import {
  getMultiTimezonePreview,
  getTimezonesByRegion,
  getLocalTimezone,
  getTimezoneInfo,
  FEATURED_TIMEZONES,
  searchTimezones,
}                          from "./modules/timezone.js";
import {
  toRelativeTime,
  getPreciseDiff,
  getDiffTable,
  formatCountdown,
  getEpochInfo,
}                          from "./modules/relativeTime.js";
import {
  processBatch,
  exportJSON,
  exportCSV,
  formatLineForDisplay,
  getBatchStats,
}                          from "./modules/batchConverter.js";
import {
  autoDetectOnOpen,
  copyToClipboard,
  readClipboard,
  buildCopyAllString,
  setupDropzone,
  detectClipboardTimestamp,
}                          from "./modules/clipboard.js";
import {
  debounce,
  storageGet,
  storageSet,
  animateCopyButton,
  flashClass,
  createElement,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  randomDateBetween,
  isValidDate,
  formatNumber,
}                          from "./modules/utils.js";

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALISATION
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Initialise i18n first (may load remote locale file)
  await i18n.init();

  // 2. Load persisted settings
  await _loadSettings();

  // 3. Boot all sub-controllers
  TabController.init();
  ThemeController.init();
  LanguageController.init();
  ConverterController.init();
  LiveClockController.init();
  BatchController.init();
  UtilitiesController.init();
  FormatStudioController.init();
  HistoryController.init();
  ClipboardController.init();
  KeyboardController.init();

  // 4. Initial resize to fit content
  TabController.resize();

  // 5. Respond to locale changes triggered by LanguageController
  document.addEventListener("localeChanged", () => {
    ConverterController.refresh();
    LiveClockController.refreshTZ();
    FormatStudioController.refresh();
    EpochController.refresh();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

/** Shared app state */
const AppState = {
  theme:          "dark",
  locale:         "en",
  lastDate:       null,
  lastFormats:    null,
  liveClockPaused: false,
  history:        [],
  HISTORY_MAX:    20,
};

const TZ_LABEL_MAP = {
  "UTC":            "tzUtc",
  "local":          "tzLocal",
  "New York":       "tzNewYork",
  "Los Angeles":    "tzLosAngeles",
  "London":         "tzLondon",
  "Berlin":         "tzBerlin",
  "Istanbul":       "tzIstanbul",
  "Dubai":          "tzDubai",
  "Mumbai/Delhi":   "tzMumbaiDelhi",
  "Shanghai":       "tzShanghai",
  "Tokyo":          "tzTokyo",
  "Sydney":         "tzSydney",
};

function _getSystemTheme() {
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

async function _loadSettings() {
  const saved  = await storageGet("theme");
  const theme  = saved || _getSystemTheme();
  const locale = await storageGet("language") || "en";
  const history = await storageGet("history") || [];

  AppState.theme   = theme;
  AppState.locale  = locale;
  AppState.history = Array.isArray(history) ? history : [];

  // Apply theme immediately to avoid flash
  document.documentElement.setAttribute("data-theme", theme);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

const Toast = (() => {
  let _timer = null;
  const el = () => document.getElementById("toast");

  function show(message, type = "", duration = 2000) {
    const toast = el();
    if (!toast) return;

    clearTimeout(_timer);
    toast.textContent = message;
    toast.className   = `toast${type ? ` toast--${type}` : ""}`;
    toast.hidden      = false;
    toast.style.animation = "none";
    // Force reflow to restart animation
    void toast.offsetWidth;
    toast.style.animation = "";

    _timer = setTimeout(() => {
      toast.style.animation = "toastOut 200ms ease forwards";
      setTimeout(() => { toast.hidden = true; }, 200);
    }, duration);
  }

  return { show };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// COPY HELPER (shared across all panels)
// ═══════════════════════════════════════════════════════════════════════════════

async function handleCopy(text, btn) {
  if (!text || text === "—") return;
  const success = await copyToClipboard(text);
  if (success) {
    Toast.show(i18n.t("copiedBtn"), "success");
    if (btn) {
      const original = btn.innerHTML;
      btn.classList.add("copied");
      setTimeout(() => btn.classList.remove("copied"), 1500);
    }
  }
}

/**
 * Attach copy button listeners to all [data-copy-target] buttons inside a root.
 * @param {HTMLElement} root
 */
function attachCopyListeners(root = document) {
  root.querySelectorAll(".copy-btn[data-copy-target]").forEach((btn) => {
    // Prevent duplicate listeners
    if (btn.dataset.copyBound) return;
    btn.dataset.copyBound = "1";

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const targetId = btn.getAttribute("data-copy-target");
      const target   = document.getElementById(targetId);
      const text     = target ? target.textContent.trim() : "";
      handleCopy(text, btn);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

const TabController = (() => {
  const TABS = ["converter", "live", "batch", "utilities", "formats"];

  function init() {
    TABS.forEach((id) => {
      const tab   = document.getElementById(`tab-${id}`);
      const panel = document.getElementById(`panel-${id}`);
      if (!tab || !panel) return;

      tab.addEventListener("click", () => switchTo(id));
      tab.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          switchTo(id);
        }
        // Arrow key navigation between tabs
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const dir    = e.key === "ArrowRight" ? 1 : -1;
          const idx    = TABS.indexOf(id);
          const next   = TABS[(idx + dir + TABS.length) % TABS.length];
          document.getElementById(`tab-${next}`)?.focus();
          switchTo(next);
        }
      });
    });

    // Restore last active tab
    storageGet("activeTab").then((saved) => {
      if (saved && TABS.includes(saved)) switchTo(saved);
      else switchTo("converter");
    });
  }

  function switchTo(id) {
    TABS.forEach((tabId) => {
      const tab   = document.getElementById(`tab-${tabId}`);
      const panel = document.getElementById(`panel-${tabId}`);
      if (!tab || !panel) return;

      const isActive = tabId === id;
      tab.classList.toggle("tab--active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
      panel.hidden = !isActive;
      if (isActive) panel.classList.add("panel--active");
      else panel.classList.remove("panel--active");
    });

    storageSet("activeTab", id);

    // Side-effects per tab
    if (id === "live") LiveClockController.resume();
    if (id === "utilities") EpochController.refresh();

    // Dynamically resize popup to fit content
    _resizePopup();
  }

  function _resizePopup() {
    requestAnimationFrame(() => {
      const body = document.body;
      const activePanel = document.querySelector(".panel:not([hidden])");
      if (!body || !activePanel) return;

      body.style.width = "";
      body.style.height = "";
      body.style.minHeight = "";

      const panelRect = activePanel.getBoundingClientRect();
      const headerEl = document.querySelector(".header");
      const tabsEl = document.querySelector(".tabs");
      const footerEl = document.querySelector(".app-footer");

      const headerH = headerEl ? headerEl.offsetHeight : 0;
      const tabsH = tabsEl ? tabsEl.offsetHeight : 0;
      const footerH = footerEl ? footerEl.offsetHeight : 0;
      const paddingY = 32;

      const neededHeight = Math.ceil(panelRect.height + headerH + tabsH + footerH + paddingY);
      const neededWidth = Math.ceil(panelRect.width);

      body.style.width = neededWidth + "px";
      body.style.minHeight = Math.max(neededHeight, 500) + "px";
    });
  }

  return { init, switchTo, resize: _resizePopup };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// THEME CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

const ThemeController = (() => {
  function init() {
    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    _applyTheme(AppState.theme);
    btn.addEventListener("click", toggle);
  }

  function toggle() {
    const next = AppState.theme === "dark" ? "light" : "dark";
    AppState.theme = next;
    _applyTheme(next);
    storageSet("theme", next);
  }

  function _applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const moonIcon = document.querySelector(".icon-moon");
    const sunIcon  = document.querySelector(".icon-sun");
    if (moonIcon) {
      moonIcon.classList.toggle("icon-moon--hidden", theme === "light");
      moonIcon.hidden = theme === "light";
    }
    if (sunIcon) {
      sunIcon.classList.toggle("icon-sun--hidden", theme === "dark");
      sunIcon.hidden = theme === "dark";
    }
  }

  return { init, toggle };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// LANGUAGE CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

const LanguageController = (() => {
  let _isOpen = false;

  function init() {
    const btn      = document.getElementById("langBtn");
    const dropdown = document.getElementById("langDropdown");
    const search   = document.getElementById("langSearch");
    const list     = document.getElementById("langList");
    if (!btn || !dropdown || !search || !list) return;

    _populateList(list, i18n.getSupportedLocales());

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      _toggleDropdown();
    });

    search.addEventListener("input", debounce(() => {
      const q = search.value.trim().toLowerCase();
      const filtered = i18n.getSupportedLocales().filter(
        (l) => l.name.toLowerCase().includes(q) ||
               l.code.toLowerCase().includes(q)
      );
      _populateList(list, filtered);
    }, 150));

    // Close on outside click
    document.addEventListener("click", (e) => {
      if (_isOpen && !dropdown.contains(e.target) && e.target !== btn) {
        _close();
      }
    });

    // Close on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && _isOpen) _close();
    });

    // Mark current locale
    _markActive(list);
  }

  function _populateList(list, locales) {
    list.innerHTML = "";
    const current = i18n.getCurrentLocale();

    locales.forEach(({ code, name }) => {
      const li = createElement("li", {
        text: name,
        attrs: {
          role: "option",
          "aria-selected": code === current ? "true" : "false",
          tabindex: "0",
        },
        dataset: { code },
      });

      li.addEventListener("click", () => _select(code));
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          _select(code);
        }
      });

      list.appendChild(li);
    });
  }

  function _markActive(list) {
    const current = i18n.getCurrentLocale();
    list.querySelectorAll("li").forEach((li) => {
      li.setAttribute(
        "aria-selected",
        li.dataset.code === current ? "true" : "false"
      );
    });
  }

  async function _select(code) {
    await i18n.setLocale(code);
    AppState.locale = code;
    _close();
    Toast.show(`${code}`, "", 1500);
  }

  function _toggleDropdown() {
    _isOpen ? _close() : _open();
  }

  function _open() {
    const dropdown = document.getElementById("langDropdown");
    const btn      = document.getElementById("langBtn");
    const search   = document.getElementById("langSearch");
    if (!dropdown) return;
    dropdown.hidden = false;
    btn?.setAttribute("aria-expanded", "true");
    _isOpen = true;
    setTimeout(() => search?.focus(), 50);
  }

  function _close() {
    const dropdown = document.getElementById("langDropdown");
    const btn      = document.getElementById("langBtn");
    if (!dropdown) return;
    dropdown.hidden = true;
    btn?.setAttribute("aria-expanded", "false");
    _isOpen = false;
  }

  return { init };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERTER CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

const ConverterController = (() => {
  // DOM refs (resolved once)
  const $ = (id) => document.getElementById(id);

  let _currentDate    = null;
  let _currentFormats = null;
  let _selectedTZ     = "local";

  function init() {
    // Convert button
    $("convertBtn")?.addEventListener("click", convert);

    // Paste button
    $("pasteBtn")?.addEventListener("click", async () => {
      const text = await readClipboard();
      if (text) {
        const input = $("mainInput");
        if (input) {
          input.value = text.trim();
          input.dispatchEvent(new Event("input"));
        }
      }
    });

    // Clear button
    $("clearBtn")?.addEventListener("click", clear);
    $("clearInputBtn")?.addEventListener("click", clear);

    // Auto-detect on input (debounced)
    $("mainInput")?.addEventListener(
      "input",
      debounce(_onInput, 300)
    );

    // Copy All button
    $("copyAllBtn")?.addEventListener("click", async () => {
      if (!_currentFormats) return;
      const text = buildCopyAllString(_currentFormats);
      await copyToClipboard(text);
      Toast.show(i18n.t("copiedBtn"), "success");
    });

    // Timezone selector
    _buildTZSelector();
    $("tzSelector")?.addEventListener("change", (e) => {
      _selectedTZ = e.target.value;
      if (_currentDate) _renderTZGrid(_currentDate);
    });

    // Dev presets collapsible
    const devHeader = $("devPresetsHeader");
    devHeader?.addEventListener("click", () => _toggleCollapsible(devHeader, "devPresetsContent"));
    devHeader?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        _toggleCollapsible(devHeader, "devPresetsContent");
      }
    });

    // Attach static copy buttons
    attachCopyListeners();

    // Drag-and-drop on main input
    const inputEl = $("mainInput");
    if (inputEl) {
      setupDropzone(inputEl, (text) => {
        inputEl.value = text;
        convert();
      });
    }
  }

  function _onInput() {
    const input = $("mainInput");
    const val   = input?.value?.trim();

    // Show/hide clear button
    $("clearInputBtn").hidden = !val;

    if (!val) {
      $("detectionBadge").hidden = true;
      return;
    }

    // Live auto-detect type
    const result = parse(val);
    if (!result.error && result.date) {
      _showDetectionBadge(result.type, result.confidence);
    } else {
      $("detectionBadge").hidden = true;
    }

    // Auto-convert if high confidence
    if (!result.error && result.confidence === "high" && isValidDate(result.date)) {
      _renderResults(result.date);
    }
  }

  function convert() {
    const input = $("mainInput");
    const val   = input?.value?.trim();

    if (!val) {
      Toast.show(i18n.t("errorEmptyInput"), "error");
      return;
    }

    const result = parse(val);

    if (result.error || !result.date || !isValidDate(result.date)) {
      _showError(result.error || i18n.t("errorInvalidInput"));
      return;
    }

    _showDetectionBadge(result.type, result.confidence);
    _renderResults(result.date);
    HistoryController.add(val, result.date);
  }

  function _renderResults(date) {
    _currentDate    = date;
    AppState.lastDate = date;

    const formats = getAllFormats(date, AppState.locale);
    _currentFormats = formats;
    AppState.lastFormats = formats;

    // Hide error, show results
    $("errorCard").hidden   = true;
    $("resultsArea").hidden = false;

    // Populate result cards
    _setText("val-unix-sec",  String(formats.unixSeconds));
    _setText("val-unix-ms",   String(formats.unixMilliseconds));
    _setText("val-iso",       formats.iso8601);
    _setText("val-utc",       formats.utcString);
    _setText("val-local",     formats.localString);
    _setText("val-rfc",       formats.rfc2822);
    _setText("val-relative",  toRelativeTime(date, AppState.locale));
    _setText("val-human",     formats.fullWeekday);

    // Multi-TZ grid
    _renderTZGrid(date);

    // Dev presets
    _renderDevPresets(date);
  }

  function _renderTZGrid(date) {
    const grid = $("tzGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const rows = getMultiTimezonePreview(date, AppState.locale);
    rows.forEach((row) => {
      grid.appendChild(_makeTZRow(row));
    });
  }

  const _makeTZRow = (row) => {
    const div = createElement("div", {
      classes: ["tz-row", row.isDST ? "tz-row--dst" : ""].filter(Boolean),
    });

    const tzKey = TZ_LABEL_MAP[row.label] || row.label;
    const tzLabel = i18n.t(tzKey);

    div.innerHTML = `
      <span class="tz-row__flag" aria-hidden="true">${row.flagEmoji}</span>
      <div class="tz-row__info">
        <div class="tz-row__label">${_esc(tzLabel)}</div>
        <div class="tz-row__time monospace">${_esc(row.formatted)}</div>
      </div>
      <span class="tz-row__offset">${_esc(row.offsetString)}</span>
    `;
    return div;
  };

  function _renderDevPresets(date) {
    const content = $("devPresetsContent");
    if (!content) return;
    content.innerHTML = "";

    const labelMap = {
      js_date:        "devPresetJsDate",
      js_iso:         "devPresetJsIso",
      js_unix:        "devPresetJsUnix",
      python_datetime:"devPresetPythonDatetime",
      python_unix:    "devPresetPythonUnix",
      sql_datetime:   "devPresetSqlDatetime",
      sql_from_unix:  "devPresetSqlFromUnix",
      postgresql:     "devPresetPostgresql",
      mongodb:        "devPresetMongodb",
      json:           "devPresetJson",
      json_unix:      "devPresetJsonUnix",
      rust:           "devPresetRust",
      go:             "devPresetGo",
      csharp:         "devPresetCsharp",
      java:           "devPresetJava",
      php:            "devPresetPhp",
      ruby:           "devPresetRuby",
      swift:          "devPresetSwift",
    };

    const presets = getDevPresets(date);
    presets.forEach((preset) => {
      const i18nKey = labelMap[preset.id] || preset.id;
      const label = i18n.t(i18nKey);
      const card = createElement("div", { classes: ["dev-preset-card"] });
      card.innerHTML = `
        <div class="dev-preset-card__header">
          <span class="dev-preset-card__lang">${_esc(preset.language)}</span>
          <span class="dev-preset-card__label">${_esc(label)}</span>
          <button class="icon-btn dev-preset-copy"
                  aria-label="${i18n.t("copyBtn")} ${_esc(label)}"
                  data-code="${_esc(preset.code)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
        </div>
        <pre class="dev-preset-card__code">${_esc(preset.code)}</pre>
      `;

      card.querySelector(".dev-preset-copy")?.addEventListener("click", async (e) => {
        const code = e.currentTarget.dataset.code;
        await copyToClipboard(code);
        Toast.show(i18n.t("devPresetCopied"), "success");
      });

      content.appendChild(card);
    });
  }

  function _showDetectionBadge(type, confidence) {
    const badge      = $("detectionBadge");
    const typeEl     = $("detectedType");
    const confidEl   = $("detectedConfidence");
    if (!badge) return;

    badge.hidden      = false;
    typeEl.textContent   = i18n.t(type) || type;
    confidEl.textContent = confidence;
    confidEl.dataset.level = confidence;
  }

  function _showError(message) {
    $("errorCard").hidden   = false;
    $("resultsArea").hidden = false;
    $("resultCards").querySelectorAll(".result-card__value")
      .forEach((el) => { el.textContent = "—"; });
    $("errorMessage").textContent = message;
  }

  function clear() {
    const input = $("mainInput");
    if (input) input.value = "";
    $("clearInputBtn").hidden     = true;
    $("detectionBadge").hidden    = true;
    $("resultsArea").hidden       = true;
    $("errorCard").hidden         = true;
    _currentDate    = null;
    _currentFormats = null;
    input?.focus();
  }

  function refresh() {
    if (_currentDate) _renderResults(_currentDate);
  }

  function _buildTZSelector() {
    const sel = $("tzSelector");
    if (!sel) return;

    const regions = getTimezonesByRegion();
    sel.innerHTML = "";

    Object.entries(regions).forEach(([region, zones]) => {
      const group = createElement("optgroup", {
        attrs: { label: region },
      });
      zones.forEach((tz) => {
        const opt = createElement("option", {
          text: tz.label,
          attrs: { value: tz.id },
        });
        group.appendChild(opt);
      });
      sel.appendChild(group);
    });
  }

  function _toggleCollapsible(header, contentId) {
    const content  = document.getElementById(contentId);
    if (!content) return;
    const expanded = header.getAttribute("aria-expanded") === "true";
    header.setAttribute("aria-expanded", String(!expanded));
    content.hidden = expanded;
  }

  // Helpers
  function _setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || "—";
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  return { init, convert, clear, refresh };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE CLOCK CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

const LiveClockController = (() => {
  let _rafId  = null;
  let _paused = false;
  let _lastSec = -1;

  function init() {
    const btn = document.getElementById("pauseResumeBtn");
    btn?.addEventListener("click", () => {
      _paused ? resume() : pause();
    });

    // Attach copy listeners for live cards
    attachCopyListeners();

    // Initial TZ grid render
    refreshTZ();
    _tick();
  }

  function _tick() {
    if (_paused) return;

    const now = new Date();
    const sec = Math.floor(now.getTime() / 1000);

    // Only update DOM when second changes (avoids excessive repaints)
    if (sec !== _lastSec) {
      _lastSec = sec;
      _update(now);
    }

    _rafId = requestAnimationFrame(_tick);
  }

  function _update(now) {
    const unixSec = Math.floor(now.getTime() / 1000);
    const unixMs  = now.getTime();

    _setText("live-unix",    String(unixSec));
    _setText("live-unix-ms", String(unixMs));
    _setText("live-utc",     now.toUTCString());
    _setText("live-local",   now.toLocaleString(AppState.locale));

    // Flash hero card for visual tick feedback
    const hero = document.querySelector(".live-card--hero");
    if (hero) flashClass(hero, "updating");

    // Update TZ grid (every second is fine since it's async-safe)
    _updateTZGrid(now);
  }

  function _updateTZGrid(date) {
    const grid = document.getElementById("tzGridLive");
    if (!grid) return;

    const rows = getMultiTimezonePreview(date, AppState.locale);

    // Reuse existing row elements if possible (avoid full re-render)
    const existing = grid.querySelectorAll(".tz-row");

    if (existing.length !== rows.length) {
      // Build from scratch
      grid.innerHTML = "";
      rows.forEach((row) => {
        const el = _makeTZRow(row);
        grid.appendChild(el);
      });
      return;
    }

    // Update in place
    rows.forEach((row, i) => {
      const el    = existing[i];
      const time  = el.querySelector(".tz-row__time");
      const offset = el.querySelector(".tz-row__offset");
      if (time)  time.textContent   = row.formatted;
      if (offset) offset.textContent = row.offsetString;
    });
  }

  function _makeTZRow(row) {
    const div = createElement("div", {
      classes: ["tz-row", row.isDST ? "tz-row--dst" : ""].filter(Boolean),
    });

    const tzKey = TZ_LABEL_MAP[row.label] || row.label;
    const tzLabel = i18n.t(tzKey);

    div.innerHTML = `
      <span class="tz-row__flag" aria-hidden="true">${row.flagEmoji}</span>
      <div class="tz-row__info">
        <div class="tz-row__label">${_esc(tzLabel)}</div>
        <div class="tz-row__time monospace">${_esc(row.formatted)}</div>
      </div>
      <span class="tz-row__offset">${_esc(row.offsetString)}</span>
    `;
    return div;
  }

  function pause() {
    _paused = true;
    AppState.liveClockPaused = true;
    if (_rafId) cancelAnimationFrame(_rafId);
    const btn = document.getElementById("pauseResumeBtn");
    const label = btn?.querySelector(".pause-label");
    const pauseIcon = btn?.querySelector(".icon-pause");
    const playIcon  = btn?.querySelector(".icon-play");
    if (label)     label.textContent = i18n.t("resumeBtn");
    if (pauseIcon) pauseIcon.hidden  = true;
    if (playIcon)  playIcon.hidden   = false;
  }

  function resume() {
    _paused = false;
    AppState.liveClockPaused = false;
    const btn = document.getElementById("pauseResumeBtn");
    const label = btn?.querySelector(".pause-label");
    const pauseIcon = btn?.querySelector(".icon-pause");
    const playIcon  = btn?.querySelector(".icon-play");
    if (label)     label.textContent = i18n.t("pauseBtn");
    if (pauseIcon) pauseIcon.hidden  = false;
    if (playIcon)  playIcon.hidden   = true;
    _tick();
  }

  function refreshTZ() {
    _updateTZGrid(new Date());
  }

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el && el.textContent !== val) el.textContent = val;
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;");
  }

  return { init, pause, resume, refreshTZ };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

const BatchController = (() => {
  let _lastResult = null;
  let _outputFormat = "iso8601";

  function init() {
    document.getElementById("batchConvertBtn")
      ?.addEventListener("click", runBatch);

    document.getElementById("batchClearBtn")
      ?.addEventListener("click", clear);

    document.getElementById("batchCopyAllBtn")
      ?.addEventListener("click", copyAll);

    document.getElementById("batchExportJsonBtn")
      ?.addEventListener("click", exportAsJSON);

    document.getElementById("batchExportCsvBtn")
      ?.addEventListener("click", exportAsCSV);

    document.getElementById("batchOutputFormat")
      ?.addEventListener("change", (e) => {
        _outputFormat = e.target.value;
        if (_lastResult) _renderTable(_lastResult);
      });

    // Drag-and-drop on batch textarea
    const textarea = document.getElementById("batchInput");
    if (textarea) {
      setupDropzone(textarea, (text) => {
        textarea.value = text;
        runBatch();
      });
    }

    attachCopyListeners();
  }

  function runBatch() {
    const text  = document.getElementById("batchInput")?.value || "";
    const dedup = document.getElementById("batchDedupe")?.checked || false;
    const skip  = document.getElementById("batchSkipBlanks")?.checked ?? true;

    if (!text.trim()) {
      Toast.show(i18n.t("errorEmptyInput"), "error");
      return;
    }

    // Show progress
    _showProgress(0);

    processBatch(text, {
      locale:      AppState.locale,
      deduplicate: dedup,
      skipBlanks:  skip,
      onProgress: (done, total) => {
        _showProgress(Math.round((done / total) * 100));
      },
      onComplete: (result) => {
        _lastResult = result;
        _hideProgress();
        _renderSummary(result.summary);
        _renderTable(result);
        _showExportButtons();
      },
    });

    // If processBatch returned synchronously (small batch)
    // onComplete has already been called above.
  }

  function _renderSummary(summary) {
    const el = document.getElementById("batchSummary");
    if (!el) return;
    el.hidden = false;
    el.innerHTML = `
      <span class="batch-summary__stat">
        <span class="batch-summary__num">${summary.total}</span> ${i18n.t("batchTotalLabel")}
      </span>
      <span class="batch-summary__stat batch-summary__success">
        <span class="batch-summary__num">${summary.successful}</span> ${i18n.t("batchSuccessLabel")}
      </span>
      <span class="batch-summary__stat batch-summary__error">
        <span class="batch-summary__num">${summary.failed}</span> ${i18n.t("batchFailedLabel")}
      </span>
      ${summary.skipped > 0 ? `
        <span class="batch-summary__stat">
          <span class="batch-summary__num">${summary.skipped}</span> ${i18n.t("batchSkippedLabel")}
        </span>` : ""}
      ${summary.duplicates > 0 ? `
        <span class="batch-summary__stat">
          <span class="batch-summary__num">${summary.duplicates}</span> ${i18n.t("batchDupesLabel")}
        </span>` : ""}
    `;
  }

  function _renderTable(result) {
    const wrapper = document.getElementById("batchResults");
    const tbody   = document.getElementById("batchTableBody");
    if (!wrapper || !tbody) return;

    tbody.innerHTML = "";

    result.lines.forEach((line) => {
      const display = formatLineForDisplay(line, _outputFormat);
      const tr      = document.createElement("tr");
      if (!display.success) tr.classList.add("error-row");

      tr.innerHTML = `
        <td class="batch-table__num">${display.lineNumber}</td>
        <td class="batch-table__input">
          <span class="batch-cell-truncate" title="${_esc(display.input)}">
            ${_esc(display.input)}
          </span>
        </td>
        <td class="batch-table__output">
          ${display.success
            ? `<span class="batch-cell-truncate monospace"
                      title="${_esc(display.primary)}">
                 ${_esc(display.primary)}
               </span>`
            : `<span class="text-error" style="color:var(--text-error)">
                 ${_esc(display.error)}
               </span>`
          }
        </td>
        <td class="batch-table__rel">${_esc(display.relative || "")}</td>
        <td class="batch-table__action">
          ${display.success ? `
            <button class="icon-btn batch-copy-row"
                    data-i18n="batchCopyRowLabel" data-i18n-attr="aria-label"
                    aria-label="Copy"
                    data-value="${_esc(display.primary)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>` : ""}
        </td>
      `;

      tr.querySelector(".batch-copy-row")?.addEventListener("click", async (e) => {
        const val = e.currentTarget.dataset.value;
        await copyToClipboard(val);
        Toast.show(i18n.t("copiedBtn"), "success");
      });

      tbody.appendChild(tr);
    });

    wrapper.hidden = false;
  }

  function _showProgress(pct) {
    const wrap = document.getElementById("batchProgress");
    const bar  = document.getElementById("batchProgressBar");
    if (!wrap || !bar) return;
    wrap.hidden = false;
    bar.style.width = `${pct}%`;
    wrap.setAttribute("aria-valuenow", String(pct));
  }

  function _hideProgress() {
    const wrap = document.getElementById("batchProgress");
    if (wrap) wrap.hidden = true;
  }

  function _showExportButtons() {
    ["batchCopyAllBtn","batchExportJsonBtn","batchExportCsvBtn"]
      .forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.hidden = false;
      });
  }

  async function copyAll() {
    if (!_lastResult) return;
    const lines = _lastResult.lines
      .filter((l) => l.success)
      .map((l) => formatLineForDisplay(l, _outputFormat).primary)
      .join("\n");
    await copyToClipboard(lines);
    Toast.show(i18n.t("copiedBtn"), "success");
  }

  function exportAsJSON() {
    if (!_lastResult) return;
    _downloadFile(
      exportJSON(_lastResult),
      "timestamps.json",
      "application/json"
    );
  }

  function exportAsCSV() {
    if (!_lastResult) return;
    _downloadFile(
      exportCSV(_lastResult),
      "timestamps.csv",
      "text/csv"
    );
  }

  function _downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = createElement("a", {
      attrs: { href: url, download: filename },
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function clear() {
    const textarea = document.getElementById("batchInput");
    if (textarea) textarea.value = "";
    document.getElementById("batchSummary").hidden  = true;
    document.getElementById("batchResults").hidden  = true;
    document.getElementById("batchProgress").hidden = true;
    ["batchCopyAllBtn","batchExportJsonBtn","batchExportCsvBtn"]
      .forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
      });
    _lastResult = null;
  }

  function _esc(str) {
    return String(str ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  return { init };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES CONTROLLER (sub-tab router)
// ═══════════════════════════════════════════════════════════════════════════════

const UtilitiesController = (() => {
  const SUB_TABS = ["diff", "generator", "epoch"];

  function init() {
    document.querySelectorAll(".sub-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.subtab;
        _switchSubTab(id);
      });
    });

    DiffController.init();
    GeneratorController.init();
    EpochController.init();
  }

  function _switchSubTab(id) {
    document.querySelectorAll(".sub-tab").forEach((btn) => {
      const active = btn.dataset.subtab === id;
      btn.classList.toggle("sub-tab--active", active);
      btn.setAttribute("aria-selected", String(active));
    });

    SUB_TABS.forEach((tabId) => {
      const panel = document.getElementById(`subpanel-${tabId}`);
      if (!panel) return;
      panel.hidden = tabId !== id;
      if (tabId === id) panel.classList.add("sub-panel--active");
      else panel.classList.remove("sub-panel--active");
    });

    if (id === "epoch") EpochController.refresh();
  }

  return { init };
})();

// ── Diff Controller ───────────────────────────────────────────────────────────

const DiffController = (() => {
  function init() {
    document.getElementById("diffCalcBtn")
      ?.addEventListener("click", calculate);

    document.getElementById("diffSwapBtn")
      ?.addEventListener("click", () => {
        const a = document.getElementById("diffDateA");
        const b = document.getElementById("diffDateB");
        if (!a || !b) return;
        [a.value, b.value] = [b.value, a.value];
        calculate();
      });

    // Auto-calculate on input
    ["diffDateA","diffDateB"].forEach((id) => {
      document.getElementById(id)?.addEventListener(
        "input",
        debounce(calculate, 400)
      );
    });
  }

  function calculate() {
    const aVal = document.getElementById("diffDateA")?.value?.trim() || "now";
    const bVal = document.getElementById("diffDateB")?.value?.trim() || "now";

    const dateA = aVal === "now" ? new Date() : parse(aVal).date;
    const dateB = bVal === "now" ? new Date() : parse(bVal).date;

    if (!dateA || !isValidDate(dateA) || !dateB || !isValidDate(dateB)) {
      const el = document.getElementById("diffResults");
      if (el) {
        el.hidden = false;
        el.innerHTML = `<div class="error-card">
          <span>${i18n.t("errorInvalidDate")}</span>
        </div>`;
      }
      return;
    }

    const diff = getDiffTable(dateA, dateB, AppState.locale);
    if (!diff) return;

    const el = document.getElementById("diffResults");
    if (!el) return;
    el.hidden = false;

    const sign = diff.isFuture ? "+" : "-";

    el.innerHTML = `
      <div class="diff-summary">${_esc(diff.humanSummary)}</div>
      <div class="diff-table">
        ${diff.rows.map((row) => `
          <div class="diff-cell">
            <span class="diff-cell__num">
              ${formatNumber(row.total, AppState.locale)}
            </span>
            <span class="diff-cell__unit">
              ${i18n.t(row.labelKey) || row.unit}
            </span>
          </div>
        `).join("")}
      </div>
    `;
  }

  function _esc(str) {
    return String(str ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;");
  }

  return { init, calculate };
})();

// ── Generator Controller ──────────────────────────────────────────────────────

const GeneratorController = (() => {
  function init() {
    document.querySelectorAll(".gen-btn").forEach((btn) => {
      btn.addEventListener("click", () => _generate(btn.dataset.gen));
    });
  }

  function _generate(type) {
    const now = new Date();
    let date;

    switch (type) {
      case "now":        date = now; break;
      case "startDay":   date = startOfDay(now); break;
      case "endDay":     date = endOfDay(now); break;
      case "startMonth": date = startOfMonth(now); break;
      case "endMonth":   date = endOfMonth(now); break;
      case "startYear":  date = startOfYear(now); break;
      case "endYear":    date = endOfYear(now); break;
      case "random": {
        const fromVal = document.getElementById("rangeFrom")?.value?.trim();
        const toVal   = document.getElementById("rangeTo")?.value?.trim();
        const from    = fromVal ? (parse(fromVal).date || new Date(0)) : new Date(0);
        const to      = toVal   ? (parse(toVal).date   || now)         : now;
        date = randomDateBetween(from, to);
        break;
      }
      default: date = now;
    }

    if (!isValidDate(date)) {
      Toast.show(i18n.t("errorInvalidDate"), "error");
      return;
    }

    _renderGeneratorResult(date);

    // Also load into the main converter input for convenience
    const input = document.getElementById("mainInput");
    if (input) {
      input.value = String(Math.floor(date.getTime() / 1000));
    }
  }

  function _renderGeneratorResult(date) {
    const wrap  = document.getElementById("generatorResult");
    const cards = document.getElementById("genResultCards");
    if (!wrap || !cards) return;

    const formats = getAllFormats(date, AppState.locale);
    wrap.hidden   = false;

    const rows = [
      { label: i18n.t("resultUnixSec"), value: String(formats.unixSeconds),      mono: true },
      { label: i18n.t("resultUnixMs"),  value: String(formats.unixMilliseconds),  mono: true },
      { label: i18n.t("resultIso"),     value: formats.iso8601,                   mono: true },
      { label: i18n.t("resultLocalTime"), value: formats.localString,             mono: false },
      { label: i18n.t("resultRelative"), value: toRelativeTime(date, AppState.locale), mono: false },
    ];

    cards.innerHTML = rows.map((row, i) => `
      <div class="result-card">
        <span class="result-card__label">${_esc(row.label)}</span>
        <span class="result-card__value ${row.mono ? "monospace" : ""}"
              id="gen-val-${i}">${_esc(row.value)}</span>
        <button class="result-card__copy copy-btn"
                data-copy-target="gen-val-${i}"
                aria-label="Copy ${_esc(row.label)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
      </div>
    `).join("");

    attachCopyListeners(cards);
  }

  function _esc(str) {
    return String(str ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  return { init };
})();

// ── Epoch Explorer Controller ─────────────────────────────────────────────────

const EpochController = (() => {
  let _countdownTimer = null;

  function init() {
    refresh();
  }

  function refresh() {
    const now  = new Date();
    const info = getEpochInfo(now, AppState.locale);
    if (!info) return;

    _renderInfoGrid(info);
    _startCountdown();
  }

  function _renderInfoGrid(info) {
    const grid = document.getElementById("epochInfoGrid");
    if (!grid) return;

    const cells = [
      {
        label: i18n.t("epochUnixEpoch"),
        value: "1970-01-01T00:00:00Z",
      },
      {
        label: i18n.t("epochCurrentUnix"),
        value: formatNumber(info.unixSeconds, AppState.locale),
      },
      {
        label: i18n.t("epochTimeSinceEpoch"),
        value: info.sinceEpoch?.summary || "—",
      },
      {
        label: i18n.t("epochY2038Boundary"),
        value: "2038-01-19T03:14:07Z",
      },
      {
        label: i18n.t("epochYourTimezone"),
        value: getLocalTimezone(),
      },
      {
        label: i18n.t("epochPrecision"),
        value: i18n.t(info.precision),
      },
    ];

    grid.innerHTML = cells.map((c) => `
      <div class="epoch-info-cell">
        <span class="epoch-info-cell__label">${_esc(c.label)}</span>
        <span class="epoch-info-cell__value">${_esc(c.value)}</span>
      </div>
    `).join("");
  }

  function _startCountdown() {
    clearInterval(_countdownTimer);
    const el = document.getElementById("y2038Countdown");
    if (!el) return;

    function tick() {
      const y2038  = new Date(2147483647 * 1000);
      const cd     = formatCountdown(y2038);
      if (!cd) return;
      el.textContent = cd.isPast
        ? i18n.t("epochY2038Passed")
        : `${cd.days}d ${String(cd.hours).padStart(2,"0")}:${String(cd.minutes).padStart(2,"0")}:${String(cd.seconds).padStart(2,"0")} ${i18n.t("epochRemaining")}`;
    }

    tick();
    _countdownTimer = setInterval(tick, 1000);
  }

  function _esc(str) {
    return String(str ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;");
  }

  return { init, refresh };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// FORMAT STUDIO CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

const FormatStudioController = (() => {
  let _currentDate = null;

  function init() {
    _buildPresetChips();
    _buildIntlOutputs();

    // Wire up all inputs with debounced preview update
    const debouncedUpdate = debounce(_updatePreview, 200);

    ["fmtInput","fmtPattern","fmtLocale"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", debouncedUpdate);
    });

    ["fmtDateStyle","fmtTimeStyle"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", debouncedUpdate);
    });

    // Pattern help toggle
    document.getElementById("fmtPatternHelpBtn")
      ?.addEventListener("click", () => {
        const help = document.getElementById("tokenHelp");
        if (help) help.hidden = !help.hidden;
      });

    // Attach copy on preview card
    attachCopyListeners();

    // Initial render
    _updatePreview();
  }

  function _buildPresetChips() {
    const container = document.getElementById("presetChips");
    if (!container) return;

    const labelMap = {
      iso_date:     "presetIsoDate",
      iso_datetime: "presetIsoDatetime",
      us_date:      "presetUsDate",
      eu_date:      "presetEuDate",
      uk_date:      "presetUkDate",
      full_date:    "presetFullDate",
      short_date:   "presetShortDate",
      time_24:      "presetTime24h",
      time_12:      "presetTime12h",
      datetime_24:  "presetDatetime24h",
      datetime_12:  "presetDatetime12h",
      unix_sec:     "presetUnixSec",
      unix_ms:      "presetUnixMs",
      with_week:    "presetWithWeek",
      quarter:      "presetQuarter",
      log_stamp:    "presetLogStamp",
      filename:     "presetFilename",
      rfc2822:      "presetRfc2822",
    };

    const presets = getFormatPresets();
    presets.forEach((preset) => {
      const i18nKey = labelMap[preset.id] || preset.id;
      const label = i18n.t(i18nKey);
      const chip = createElement("button", {
        classes: ["preset-chip"],
        text:    label,
        attrs:   { type: "button", "aria-label": i18n.t("presetApplyLabel", [label]) },
      });

      chip.addEventListener("click", () => {
        // Deactivate all
        container.querySelectorAll(".preset-chip").forEach((c) =>
          c.classList.remove("preset-chip--active")
        );
        chip.classList.add("preset-chip--active");

        // Apply pattern
        const patternInput = document.getElementById("fmtPattern");
        if (patternInput && preset.pattern) {
          patternInput.value = preset.pattern;
        }

        // Reset date style for custom patterns
        const styleSelect = document.getElementById("fmtDateStyle");
        if (styleSelect) styleSelect.value = "";

        _updatePreview();
      });

      container.appendChild(chip);
    });
  }

  function _buildIntlOutputs() {
    const container = document.getElementById("intlOutputs");
    if (!container) return;

    const styles = [
      { id: "full",   label: i18n.t("intlStyleFull"),   dateStyle: "full",   timeStyle: "full" },
      { id: "long",   label: i18n.t("intlStyleLong"),   dateStyle: "long",   timeStyle: "long" },
      { id: "medium", label: i18n.t("intlStyleMedium"), dateStyle: "medium", timeStyle: "medium" },
      { id: "short",  label: i18n.t("intlStyleShort"),  dateStyle: "short",  timeStyle: "short" },
      { id: "date",   label: i18n.t("intlStyleDateOnly"), dateStyle: "long",  timeStyle: null },
      { id: "time",   label: i18n.t("intlStyleTimeOnly"), dateStyle: null,    timeStyle: "medium" },
    ];

    container.innerHTML = styles.map((s) => `
      <div class="intl-output-row" id="intl-row-${s.id}">
        <span class="intl-output-row__label">${_esc(s.label)}</span>
        <span class="intl-output-row__value" id="intl-val-${s.id}">—</span>
      </div>
    `).join("");
  }

  function _updatePreview() {
    const inputVal   = document.getElementById("fmtInput")?.value?.trim();
    const pattern    = document.getElementById("fmtPattern")?.value || "";
    const locale     = document.getElementById("fmtLocale")?.value?.trim() || "en";
    const dateStyle  = document.getElementById("fmtDateStyle")?.value || "";
    const timeStyle  = document.getElementById("fmtTimeStyle")?.value || "";

    // Determine date to format
    let date;
    if (inputVal) {
      const parsed = parse(inputVal);
      date = parsed.date && isValidDate(parsed.date) ? parsed.date : new Date();
    } else {
      date = new Date();
    }

    _currentDate = date;

    // Custom pattern output
    const previewEl = document.getElementById("fmtPreview");
    if (previewEl) {
      if (dateStyle || timeStyle) {
        // Use Intl style
        try {
          const opts = {};
          if (dateStyle) opts.dateStyle = dateStyle;
          if (timeStyle) opts.timeStyle = timeStyle;
          previewEl.textContent = formatIntl(date, locale, opts);
        } catch (_) {
          previewEl.textContent = formatPattern(date, pattern, locale);
        }
      } else {
        previewEl.textContent = pattern
          ? formatPattern(date, pattern, locale)
          : date.toISOString();
      }
    }

    // Intl style outputs
    const styles = [
      { id: "full",   opts: { dateStyle: "full",   timeStyle: "full"   } },
      { id: "long",   opts: { dateStyle: "long",   timeStyle: "long"   } },
      { id: "medium", opts: { dateStyle: "medium", timeStyle: "medium" } },
      { id: "short",  opts: { dateStyle: "short",  timeStyle: "short"  } },
      { id: "date",   opts: { dateStyle: "long"                        } },
      { id: "time",   opts: { timeStyle: "medium"                      } },
    ];

    styles.forEach(({ id, opts }) => {
      const el = document.getElementById(`intl-val-${id}`);
      if (el) {
        try {
          el.textContent = formatIntl(date, locale, opts);
        } catch (_) {
          el.textContent = "—";
        }
      }
    });
  }

  function refresh() {
    _updatePreview();
  }

  function _esc(str) {
    return String(str ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;");
  }

  return { init, refresh };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORY CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

const HistoryController = (() => {
  function init() {
    // History header collapse
    const header = document.getElementById("historyHeader");
    header?.addEventListener("click", () => {
      const list     = document.getElementById("historyList");
      const expanded = header.getAttribute("aria-expanded") === "true";
      header.setAttribute("aria-expanded", String(!expanded));
      if (list) list.hidden = expanded;
    });
    header?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        header.click();
      }
    });

    // Clear history
    document.getElementById("clearHistoryBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      AppState.history = [];
      storageSet("history", []);
      _render();
    });

    _render();
  }

  function add(input, date) {
    if (!input || !isValidDate(date)) return;

    const formats = getAllFormats(date, AppState.locale);
    const entry   = {
      input:  input.trim(),
      iso:    formats.iso8601,
      unix:   formats.unixSeconds,
      ts:     Date.now(),
    };

    // Deduplicate by input
    AppState.history = AppState.history.filter(
      (h) => h.input !== entry.input
    );
    AppState.history.unshift(entry);

    if (AppState.history.length > AppState.HISTORY_MAX) {
      AppState.history.length = AppState.HISTORY_MAX;
    }

    storageSet("history", AppState.history);
    _render();
  }

  function _render() {
    const list    = document.getElementById("historyList");
    const section = document.getElementById("historySection");
    if (!list || !section) return;

    if (AppState.history.length === 0) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    list.innerHTML = "";

    AppState.history.forEach((entry) => {
      const li = createElement("li", {
        classes: ["history-item"],
        attrs:   { role: "listitem", tabindex: "0" },
      });

      const relTime = toRelativeTime(new Date(entry.ts), AppState.locale);

      li.innerHTML = `
        <span class="history-item__input">${_esc(entry.input)}</span>
        <span class="history-item__arrow">→</span>
        <span class="history-item__result">${_esc(entry.iso)}</span>
        <span class="history-item__time">${_esc(relTime)}</span>
      `;

      // Click to re-populate input
      li.addEventListener("click", () => {
        const input = document.getElementById("mainInput");
        if (input) {
          input.value = entry.input;
          TabController.switchTo("converter");
          ConverterController.convert();
        }
      });

      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          li.click();
        }
      });

      list.appendChild(li);
    });
  }

  function _esc(str) {
    return String(str ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;");
  }

  return { init, add };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// CLIPBOARD CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

const ClipboardController = (() => {
  let _pendingClipboardText = null;

  function init() {
    // Auto-detect clipboard on open
    autoDetectOnOpen({
      onDetected: (detection) => {
        _pendingClipboardText = detection.text;
        _showBanner(detection);
      },
      onDenied: () => { /* silently ignore */ },
      onEmpty:  () => { /* nothing to show */ },
    });

    // Banner buttons
    document.getElementById("clipboardConvertBtn")
      ?.addEventListener("click", () => {
        if (_pendingClipboardText) {
          const input = document.getElementById("mainInput");
          if (input) {
            input.value = _pendingClipboardText;
            TabController.switchTo("converter");
            ConverterController.convert();
          }
          _hideBanner();
        }
      });

    document.getElementById("clipboardDismissBtn")
      ?.addEventListener("click", _hideBanner);
  }

  function _showBanner(detection) {
    const banner  = document.getElementById("clipboardBanner");
    const textEl  = document.getElementById("clipboardBannerText");
    if (!banner) return;

    const detected = i18n.t(detection.type) || detection.type;
    const preview  = detection.text.length > 30
      ? detection.text.slice(0, 30) + "…"
      : detection.text;

    if (textEl) {
      textEl.textContent = `${i18n.t("clipboardDetected")}: ${preview}`;
    }

    banner.hidden = false;
  }

  function _hideBanner() {
    const banner = document.getElementById("clipboardBanner");
    if (banner) banner.hidden = true;
    _pendingClipboardText = null;
  }

  return { init };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// KEYBOARD CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

const KeyboardController = (() => {
  function init() {
    document.addEventListener("keydown", (e) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const ctrl  = isMac ? e.metaKey : e.ctrlKey;

      // Ctrl/Cmd + Enter → Convert
      if (ctrl && e.key === "Enter") {
        e.preventDefault();
        ConverterController.convert();
        return;
      }

      // Escape → Clear (only when input is focused)
      if (e.key === "Escape") {
        const focused = document.activeElement;
        const input   = document.getElementById("mainInput");
        if (focused === input || focused === document.body) {
          e.preventDefault();
          ConverterController.clear();
        }
        return;
      }

      // Ctrl/Cmd + Shift + C → Copy result
      if (ctrl && e.shiftKey && e.key === "C") {
        e.preventDefault();
        const isoEl = document.getElementById("val-iso");
        const text  = isoEl?.textContent?.trim();
        if (text && text !== "—") {
          copyToClipboard(text).then(() => {
            Toast.show(i18n.t("copiedBtn"), "success");
          });
        }
        return;
      }

      // Ctrl/Cmd + K → Focus main input (quick-open style)
      if (ctrl && e.key === "k") {
        e.preventDefault();
        TabController.switchTo("converter");
        const input = document.getElementById("mainInput");
        input?.focus();
        input?.select();
        return;
      }

      // Ctrl/Cmd + L → Focus live clock tab
      if (ctrl && e.key === "l") {
        e.preventDefault();
        TabController.switchTo("live");
        return;
      }

      // Ctrl/Cmd + B → Focus batch tab
      if (ctrl && e.key === "b") {
        e.preventDefault();
        TabController.switchTo("batch");
        const batchInput = document.getElementById("batchInput");
        batchInput?.focus();
        return;
      }
    });
  }

  return { init };
})();