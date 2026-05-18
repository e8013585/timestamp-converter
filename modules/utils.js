/**
 * utils.js
 * Shared utility functions for Timestamp Converter.
 *
 * Pure functions — no DOM access, no side effects.
 * Fully offline-capable, no external dependencies.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Unix timestamp (seconds) boundaries for sanity checks */
export const UNIX_MIN = -8_640_000_000_000; // ~Year -271,821
export const UNIX_MAX = 8_640_000_000_000;  // ~Year 275,760

/** The Y2038 overflow boundary for 32-bit signed int (seconds) */
export const Y2038_BOUNDARY = 2_147_483_647;

/** Milliseconds per unit */
export const MS = {
  SECOND: 1_000,
  MINUTE: 60_000,
  HOUR: 3_600_000,
  DAY: 86_400_000,
  WEEK: 604_800_000,
  MONTH: 2_629_746_000, // average
  YEAR: 31_556_952_000, // average
};

// ── Timestamp Detection Helpers ───────────────────────────────────────────────

/**
 * Determine if a number looks like Unix seconds (10 digits) or ms (13 digits).
 * @param {number|string} value
 * @returns {"seconds"|"milliseconds"|null}
 */
export function detectTimestampPrecision(value) {
  const str = String(value).replace(/[^0-9\-]/g, "");
  const abs = str.replace("-", "");
  if (abs.length >= 10 && abs.length <= 11) return "seconds";
  if (abs.length >= 12 && abs.length <= 14) return "milliseconds";
  return null;
}

/**
 * Normalise any timestamp-like input to a milliseconds number.
 * @param {number|string} value
 * @returns {number|null}
 */
export function toMilliseconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const precision = detectTimestampPrecision(value);
  if (precision === "seconds") return n * 1000;
  if (precision === "milliseconds") return n;

  // Fallback: try treating as seconds if abs < 1e11
  if (Math.abs(n) < 1e11) return n * 1000;
  return n;
}

// ── Date Validation ───────────────────────────────────────────────────────────

/**
 * Check if a Date object is valid.
 * @param {Date} date
 * @returns {boolean}
 */
export function isValidDate(date) {
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Check if a timestamp (ms) is within a representable browser range.
 * @param {number} ms
 * @returns {boolean}
 */
export function isInRange(ms) {
  return ms >= UNIX_MIN * 1000 && ms <= UNIX_MAX * 1000;
}

// ── String Utilities ──────────────────────────────────────────────────────────

/**
 * Pad a number to a given width with leading zeros.
 * @param {number} n
 * @param {number} [width=2]
 * @returns {string}
 */
export function pad(n, width = 2) {
  return String(Math.abs(n)).padStart(width, "0");
}

/**
 * Truncate a string to maxLen characters with an ellipsis.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
export function truncate(str, maxLen = 60) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

/**
 * Escape HTML special characters to prevent XSS in innerHTML.
 * @param {string} str
 * @returns {string}
 */
export function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Debounce / Throttle ───────────────────────────────────────────────────────

/**
 * Debounce a function call.
 * @param {Function} fn
 * @param {number} delay - milliseconds
 * @returns {Function}
 */
export function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Throttle a function call (leading edge).
 * @param {Function} fn
 * @param {number} limit - milliseconds
 * @returns {Function}
 */
export function throttle(fn, limit) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      return fn.apply(this, args);
    }
  };
}

// ── Clipboard Utilities ───────────────────────────────────────────────────────

/**
 * Copy text to clipboard using the modern Clipboard API with execCommand fallback.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback
    const el = document.createElement("textarea");
    el.value = text;
    el.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(el);
    el.select();
    const success = document.execCommand("copy");
    document.body.removeChild(el);
    return success;
  } catch (_) {
    return false;
  }
}

/**
 * Read text from clipboard.
 * @returns {Promise<string|null>}
 */
export async function readFromClipboard() {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      return await navigator.clipboard.readText();
    }
    return null;
  } catch (_) {
    return null;
  }
}

// ── Number Formatting ─────────────────────────────────────────────────────────

/**
 * Format a number with thousands separators.
 * @param {number} n
 * @param {string} [locale="en"]
 * @returns {string}
 */
export function formatNumber(n, locale = "en") {
  try {
    return new Intl.NumberFormat(locale).format(n);
  } catch (_) {
    return String(n);
  }
}

// ── Date Boundary Helpers ─────────────────────────────────────────────────────

/**
 * Get start of day (local midnight) for a given Date.
 * @param {Date} [date=new Date()]
 * @returns {Date}
 */
export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get end of day (local 23:59:59.999) for a given Date.
 * @param {Date} [date=new Date()]
 * @returns {Date}
 */
export function endOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Get start of month for a given Date.
 * @param {Date} [date=new Date()]
 * @returns {Date}
 */
export function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * Get end of month for a given Date.
 * @param {Date} [date=new Date()]
 * @returns {Date}
 */
export function endOfMonth(date = new Date()) {
  return new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );
}

/**
 * Get start of year for a given Date.
 * @param {Date} [date=new Date()]
 * @returns {Date}
 */
export function startOfYear(date = new Date()) {
  return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0);
}

/**
 * Get end of year for a given Date.
 * @param {Date} [date=new Date()]
 * @returns {Date}
 */
export function endOfYear(date = new Date()) {
  return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
}

/**
 * Generate a random Date between two Date objects.
 * @param {Date} from
 * @param {Date} to
 * @returns {Date}
 */
export function randomDateBetween(from, to) {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const randomMs = fromMs + Math.random() * (toMs - fromMs);
  return new Date(randomMs);
}

// ── Diff Helpers ──────────────────────────────────────────────────────────────

/**
 * Calculate the absolute difference between two dates in various units.
 * @param {Date} dateA
 * @param {Date} dateB
 * @returns {{
 *   ms: number,
 *   seconds: number,
 *   minutes: number,
 *   hours: number,
 *   days: number,
 *   months: number,
 *   years: number,
 *   sign: 1|-1
 * }}
 */
export function dateDiff(dateA, dateB) {
  const diff = dateB.getTime() - dateA.getTime();
  const sign = diff >= 0 ? 1 : -1;
  const abs = Math.abs(diff);

  const totalSeconds = Math.floor(abs / 1000);
  const totalMinutes = Math.floor(abs / MS.MINUTE);
  const totalHours = Math.floor(abs / MS.HOUR);
  const totalDays = Math.floor(abs / MS.DAY);

  // Calendar-accurate months/years
  const [start, end] =
    sign >= 0 ? [dateA, dateB] : [dateB, dateA];

  let years = end.getFullYear() - start.getFullYear();
  let months =
    years * 12 + (end.getMonth() - start.getMonth());

  // Adjust if end day < start day
  if (end.getDate() < start.getDate()) months--;
  years = Math.floor(months / 12);

  return {
    ms: abs,
    seconds: totalSeconds,
    minutes: totalMinutes,
    hours: totalHours,
    days: totalDays,
    months: Math.max(0, months),
    years: Math.max(0, years),
    sign,
  };
}

// ── Storage Helpers ───────────────────────────────────────────────────────────

/**
 * Get a value from chrome.storage.local (or localStorage fallback).
 * @param {string} key
 * @returns {Promise<any>}
 */
export function storageGet(key) {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get(key, (result) => resolve(result[key]));
    } else {
      try {
        const val = localStorage.getItem(`ts_${key}`);
        resolve(val !== null ? JSON.parse(val) : undefined);
      } catch (_) {
        resolve(undefined);
      }
    }
  });
}

/**
 * Set a value in chrome.storage.local (or localStorage fallback).
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
export function storageSet(key, value) {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ [key]: value }, resolve);
    } else {
      try {
        localStorage.setItem(`ts_${key}`, JSON.stringify(value));
      } catch (_) {}
      resolve();
    }
  });
}

/**
 * Remove a value from chrome.storage.local (or localStorage fallback).
 * @param {string} key
 * @returns {Promise<void>}
 */
export function storageRemove(key) {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.remove(key, resolve);
    } else {
      try {
        localStorage.removeItem(`ts_${key}`);
      } catch (_) {}
      resolve();
    }
  });
}

// ── DOM Helpers ───────────────────────────────────────────────────────────────

/**
 * Create an element with optional attributes, classes, and text.
 * @param {string} tag
 * @param {Object} [opts]
 * @param {string} [opts.text]
 * @param {string} [opts.html]
 * @param {string[]} [opts.classes]
 * @param {Object} [opts.attrs]
 * @param {Object} [opts.dataset]
 * @returns {HTMLElement}
 */
export function createElement(tag, opts = {}) {
  const el = document.createElement(tag);
  if (opts.text) el.textContent = opts.text;
  if (opts.html) el.innerHTML = opts.html;
  if (opts.classes) el.classList.add(...opts.classes);
  if (opts.attrs) {
    Object.entries(opts.attrs).forEach(([k, v]) => el.setAttribute(k, v));
  }
  if (opts.dataset) {
    Object.entries(opts.dataset).forEach(([k, v]) => (el.dataset[k] = v));
  }
  return el;
}

/**
 * Add a temporary CSS class to an element, then remove it after a delay.
 * Useful for flash animations on copy/paste.
 * @param {HTMLElement} el
 * @param {string} cls
 * @param {number} [duration=1500]
 */
export function flashClass(el, cls, duration = 1500) {
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), duration);
}

/**
 * Animate a button to show a "copied!" state temporarily.
 * @param {HTMLElement} btn
 * @param {string} successText
 * @param {number} [duration=2000]
 */
export function animateCopyButton(btn, successText, duration = 2000) {
  const original = btn.textContent;
  btn.textContent = successText;
  btn.classList.add("btn--copied");
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove("btn--copied");
    btn.disabled = false;
  }, duration);
}

// ── Misc ──────────────────────────────────────────────────────────────────────

/**
 * Generate a simple unique ID string.
 * @returns {string}
 */
export function uid() {
  return `_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Check if the current environment is a Chrome extension context.
 * @returns {boolean}
 */
export function isExtensionContext() {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.runtime !== "undefined" &&
    !!chrome.runtime.id
  );
}

/**
 * Safe JSON parse — returns null on error.
 * @param {string} str
 * @returns {any|null}
 */
export function safeJSON(str) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return null;
  }
}