/**
 * clipboard.js
 * Clipboard intelligence module for Timestamp Converter.
 *
 * Provides:
 *   - Auto-paste detection on extension open
 *   - Timestamp/date detection in clipboard content
 *   - Smart clipboard polling (respects browser permissions)
 *   - Copy with feedback
 *   - Clipboard history (session-only, in-memory)
 *   - Permission-aware graceful degradation
 *
 * Uses:
 *   - navigator.clipboard (Async Clipboard API)
 *   - document.execCommand fallback
 *
 * Privacy:
 *   - No clipboard data is stored persistently
 *   - No data leaves the device
 *   - History is session-memory only and cleared on popup close
 */

import { parse }            from "./parser.js";
import { isValidDate }      from "./utils.js";
import { INPUT_TYPES }      from "./parser.js";

// ── Clipboard History (session-only) ──────────────────────────────────────────

/** Max entries in in-memory clipboard history */
const HISTORY_MAX = 20;

/** In-memory clipboard copy history for this session */
const _history = [];

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Check if a string looks like a timestamp or date we can convert.
 * Lightweight pre-check before full parse.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeTimestamp(text) {
  if (!text || typeof text !== "string") return false;

  const trimmed = text.trim();

  // Too long to be a single timestamp/date (allow multi-word dates)
  if (trimmed.length > 200) return false;

  // Too short
  if (trimmed.length < 1) return false;

  // Quick pattern checks (cheap, before full parse)
  const quickPatterns = [
    /^\d{9,14}$/,                                     // Unix timestamp
    /^\d{4}-\d{2}-\d{2}/,                            // ISO date start
    /\d{1,2}\/\d{1,2}\/\d{4}/,                       // US/EU date
    /\d{1,2}\.\d{1,2}\.\d{4}/,                       // EU date with dots
    /[A-Za-z]+ \d{1,2},? \d{4}/,                     // "May 9 2026"
    /\d{1,2} [A-Za-z]+ \d{4}/,                       // "9 May 2026"
    /^(now|today|yesterday|tomorrow)$/i,              // Keywords
    /^\d+ (second|minute|hour|day|week|month|year)s? ago$/i, // Relative
    /^in \d+ (second|minute|hour|day|week|month|year)s?$/i,  // Future relative
    /^(next|last) [a-z]+/i,                           // "next Friday"
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+\d{1,2}/i,  // RFC 2822
  ];

  return quickPatterns.some((rx) => rx.test(trimmed));
}

/**
 * Fully parse clipboard text and return detection result.
 *
 * @param {string} text
 * @returns {ClipboardDetection|null}
 */
export function detectClipboardTimestamp(text) {
  if (!looksLikeTimestamp(text)) return null;

  try {
    const result = parse(text.trim());

    if (result.error || !result.date || !isValidDate(result.date)) {
      return null;
    }

    return {
      text:       text.trim(),
      date:       result.date,
      type:       result.type,
      confidence: result.confidence,
      normalised: result.normalised,
    };
  } catch (_) {
    return null;
  }
}

// ── Read from Clipboard ───────────────────────────────────────────────────────

/**
 * Read text from the system clipboard.
 * Returns null if permission denied or API unavailable.
 *
 * @returns {Promise<string|null>}
 */
export async function readClipboard() {
  // Modern Async API
  if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
    try {
      const text = await navigator.clipboard.readText();
      return typeof text === "string" ? text : null;
    } catch (err) {
      // Permission denied (NotAllowedError) or other error
      if (err.name === "NotAllowedError") {
        console.info("[clipboard] Read permission not granted.");
      }
      return null;
    }
  }

  return null;
}

/**
 * Check if clipboard read permission is granted.
 * @returns {Promise<"granted"|"denied"|"prompt"|"unavailable">}
 */
export async function checkClipboardPermission() {
  if (!navigator.permissions) return "unavailable";

  try {
    const result = await navigator.permissions.query({
      name: "clipboard-read",
    });
    return result.state; // "granted" | "denied" | "prompt"
  } catch (_) {
    return "unavailable";
  }
}

// ── Write to Clipboard ────────────────────────────────────────────────────────

/**
 * Copy text to the system clipboard.
 * Tries modern API first, falls back to execCommand.
 *
 * @param {string} text
 * @returns {Promise<boolean>}  - true if successful
 */
export async function copyToClipboard(text) {
  if (!text || typeof text !== "string") return false;

  // Modern Async Clipboard API
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      _addToHistory(text);
      return true;
    } catch (_) {
      // Fall through to execCommand
    }
  }

  // Legacy execCommand fallback
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.cssText = [
      "position:fixed",
      "top:-9999px",
      "left:-9999px",
      "opacity:0",
      "pointer-events:none",
      "user-select:all",
    ].join(";");
    document.body.appendChild(el);
    el.focus();
    el.select();
    const success = document.execCommand("copy");
    document.body.removeChild(el);
    if (success) _addToHistory(text);
    return success;
  } catch (_) {
    return false;
  }
}

// ── Auto-Detection on Open ────────────────────────────────────────────────────

/**
 * Attempt to auto-detect a timestamp in the clipboard when the popup opens.
 * Calls onDetected if a timestamp is found, onDenied if permission is missing.
 *
 * @param {Object} callbacks
 * @param {Function} callbacks.onDetected  - (ClipboardDetection) => void
 * @param {Function} [callbacks.onDenied]  - () => void
 * @param {Function} [callbacks.onEmpty]   - () => void
 * @returns {Promise<void>}
 */
export async function autoDetectOnOpen({ onDetected, onDenied, onEmpty }) {
  const permission = await checkClipboardPermission();

  if (permission === "denied") {
    if (onDenied) onDenied();
    return;
  }

  const text = await readClipboard();

  if (!text || !text.trim()) {
    if (onEmpty) onEmpty();
    return;
  }

  const detection = detectClipboardTimestamp(text);

  if (detection) {
    onDetected(detection);
  } else {
    if (onEmpty) onEmpty();
  }
}

// ── Clipboard History ─────────────────────────────────────────────────────────

/**
 * Add a copied string to the in-memory history.
 * @param {string} text
 */
function _addToHistory(text) {
  // Deduplicate
  const idx = _history.indexOf(text);
  if (idx !== -1) _history.splice(idx, 1);

  _history.unshift(text);

  // Enforce max
  if (_history.length > HISTORY_MAX) {
    _history.length = HISTORY_MAX;
  }
}

/**
 * Get the copy history for this session.
 * @returns {string[]}
 */
export function getCopyHistory() {
  return [..._history];
}

/**
 * Clear copy history.
 */
export function clearCopyHistory() {
  _history.length = 0;
}

// ── Multi-Field Copy Builder ──────────────────────────────────────────────────

/**
 * Build a formatted multi-field copy string from a formats object.
 * Useful for "Copy All" functionality.
 *
 * @param {Object} formats - getAllFormats() output
 * @param {string[]} [fields] - which fields to include
 * @returns {string}
 */
export function buildCopyAllString(formats, fields) {
  if (!formats) return "";

  const defaultFields = [
    "unixSeconds",
    "unixMilliseconds",
    "iso8601",
    "iso8601utc",
    "rfc2822",
    "utcString",
    "localString",
    "sqlDatetime",
  ];

  const selectedFields = fields || defaultFields;

  const labels = {
    unixSeconds:      "Unix (s):   ",
    unixMilliseconds: "Unix (ms):  ",
    iso8601:          "ISO 8601:   ",
    iso8601utc:       "ISO UTC:    ",
    rfc2822:          "RFC 2822:   ",
    utcString:        "UTC:        ",
    localString:      "Local:      ",
    sqlDatetime:      "SQL:        ",
    dateOnly:         "Date:       ",
    timeOnly:         "Time:       ",
  };

  return selectedFields
    .filter((field) => formats[field] !== undefined)
    .map((field) => {
      const label = labels[field] || `${field}: `.padEnd(12);
      return `${label}${formats[field]}`;
    })
    .join("\n");
}

// ── Share / Export ────────────────────────────────────────────────────────────

/**
 * Attempt to use the Web Share API if available (mobile/some desktops).
 * Falls back to clipboard copy.
 *
 * @param {string} text
 * @param {string} [title]
 * @returns {Promise<"shared"|"copied"|"failed">}
 */
export async function shareOrCopy(text, title = "Timestamp Conversion") {
  if (navigator.share && navigator.canShare?.({ text })) {
    try {
      await navigator.share({ title, text });
      return "shared";
    } catch (_) {
      // User dismissed or share failed — fall through
    }
  }

  const copied = await copyToClipboard(text);
  return copied ? "copied" : "failed";
}

// ── Drag-and-Drop Text Helper ─────────────────────────────────────────────────

/**
 * Extract text content from a DataTransfer object (from drag events).
 * @param {DataTransfer} dataTransfer
 * @returns {string|null}
 */
export function getDroppedText(dataTransfer) {
  if (!dataTransfer) return null;

  // Try plain text first
  const text = dataTransfer.getData("text/plain");
  if (text) return text;

  // Try HTML and strip tags
  const html = dataTransfer.getData("text/html");
  if (html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || null;
  }

  return null;
}

/**
 * Set up drag-and-drop text handling on an element.
 * @param {HTMLElement} element
 * @param {Function} onText - called with extracted text string
 * @returns {Function} - call to remove listeners
 */
export function setupDropzone(element, onText) {
  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    element.classList.add("dropzone--active");
  }

  function onDragLeave() {
    element.classList.remove("dropzone--active");
  }

  function onDrop(e) {
    e.preventDefault();
    element.classList.remove("dropzone--active");
    const text = getDroppedText(e.dataTransfer);
    if (text && text.trim()) {
      onText(text.trim());
    }
  }

  element.addEventListener("dragover",  onDragOver);
  element.addEventListener("dragleave", onDragLeave);
  element.addEventListener("drop",      onDrop);

  // Return cleanup function
  return function cleanup() {
    element.removeEventListener("dragover",  onDragOver);
    element.removeEventListener("dragleave", onDragLeave);
    element.removeEventListener("drop",      onDrop);
  };
}