/**
 * formatter.js
 * Date formatting engine for Timestamp Converter.
 *
 * Provides:
 *   - Standard format outputs (ISO, RFC, UTC, Local, Human-readable)
 *   - Custom pattern formatting (YYYY-MM-DD, HH:mm:ss, etc.)
 *   - Locale-aware Intl.DateTimeFormat output
 *   - Developer preset snippets (JS, Python, SQL, MongoDB, etc.)
 *   - All formatting is pure and deterministic
 *
 * Pattern tokens (custom format):
 *   YYYY  - 4-digit year
 *   YY    - 2-digit year
 *   MMMM  - Full month name (locale-aware)
 *   MMM   - Short month name (locale-aware)
 *   MM    - 2-digit month (01-12)
 *   M     - Month (1-12)
 *   DDDD  - Full weekday name (locale-aware)
 *   DDD   - Short weekday name (locale-aware)
 *   DD    - 2-digit day (01-31)
 *   D     - Day (1-31)
 *   HH    - 24h hours (00-23)
 *   H     - 24h hours (0-23)
 *   hh    - 12h hours (01-12)
 *   h     - 12h hours (1-12)
 *   mm    - minutes (00-59)
 *   ss    - seconds (00-59)
 *   SSS   - milliseconds (000-999)
 *   A     - AM/PM
 *   a     - am/pm
 *   Z     - UTC offset (+05:30)
 *   ZZ    - UTC offset (+0530)
 *   X     - Unix timestamp seconds
 *   x     - Unix timestamp milliseconds
 *   Q     - Quarter (1-4)
 *   WW    - ISO week number (01-53)
 *   Do    - Day with ordinal (1st, 2nd...)
 */

import { pad } from "./utils.js";

// ── Locale cache ──────────────────────────────────────────────────────────────
// Reusing Intl formatters is significantly cheaper than creating them on each call
const _fmtCache = new Map();

function _getCachedFmt(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`;
  if (!_fmtCache.has(key)) {
    _fmtCache.set(key, new Intl.DateTimeFormat(locale, options));
  }
  return _fmtCache.get(key);
}

// ── UTC Offset Helpers ────────────────────────────────────────────────────────

/**
 * Get the UTC offset string for a Date in local timezone.
 * @param {Date} date
 * @param {boolean} [colon=true] - include colon in "+05:30" vs "+0530"
 * @returns {string}
 */
export function getUTCOffset(date, colon = true) {
  const offset = -date.getTimezoneOffset(); // minutes
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const h = pad(Math.floor(abs / 60));
  const m = pad(abs % 60);
  return colon ? `${sign}${h}:${m}` : `${sign}${h}${m}`;
}

// ── Ordinal Helper ─────────────────────────────────────────────────────────────

function _ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── ISO Week Number ───────────────────────────────────────────────────────────

function _isoWeekNumber(date) {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return pad(Math.ceil(((d - yearStart) / 86400000 + 1) / 7));
}

// ── Quarter ───────────────────────────────────────────────────────────────────

function _quarter(date) {
  return Math.floor(date.getMonth() / 3) + 1;
}

// ── Custom Pattern Formatter ──────────────────────────────────────────────────

/**
 * Format a Date using a custom pattern string.
 * @param {Date} date
 * @param {string} pattern
 * @param {string} [locale="en"]
 * @returns {string}
 */
export function formatPattern(date, pattern, locale = "en") {
  if (!date || isNaN(date.getTime())) return "Invalid Date";

  // Pre-compute all token values
  const y    = date.getFullYear();
  const M    = date.getMonth(); // 0-based
  const d    = date.getDate();
  const H    = date.getHours();
  const m    = date.getMinutes();
  const s    = date.getSeconds();
  const ms   = date.getMilliseconds();
  const dow  = date.getDay(); // 0=Sun

  // Locale-aware month and day names
  const fullMonth  = new Intl.DateTimeFormat(locale, { month: "long"  }).format(date);
  const shortMonth = new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
  const fullDay    = new Intl.DateTimeFormat(locale, { weekday: "long"  }).format(date);
  const shortDay   = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);

  const h12 = H % 12 || 12;
  const ampm = H < 12 ? "AM" : "PM";

  const unixSec = Math.floor(date.getTime() / 1000);
  const unixMs  = date.getTime();

  // Token replacement map — order matters (longest tokens first)
  const tokens = {
    "YYYY": String(y),
    "YY":   String(y).slice(-2),
    "MMMM": fullMonth,
    "MMM":  shortMonth,
    "MM":   pad(M + 1),
    "M":    String(M + 1),
    "DDDD": fullDay,
    "DDD":  shortDay,
    "DD":   pad(d),
    "Do":   _ordinal(d),
    "D":    String(d),
    "HH":   pad(H),
    "H":    String(H),
    "hh":   pad(h12),
    "h":    String(h12),
    "mm":   pad(m),
    "ss":   pad(s),
    "SSS":  pad(ms, 3),
    "A":    ampm,
    "a":    ampm.toLowerCase(),
    "ZZ":   getUTCOffset(date, false),
    "Z":    getUTCOffset(date, true),
    "X":    String(unixSec),
    "x":    String(unixMs),
    "Q":    String(_quarter(date)),
    "WW":   _isoWeekNumber(date),
  };

  // Replace tokens using a single regex pass
  const tokenRx = new RegExp(Object.keys(tokens).join("|"), "g");
  return pattern.replace(tokenRx, (match) => tokens[match] || match);
}

// ── Standard Formatters ───────────────────────────────────────────────────────

/**
 * Format a Date as ISO 8601 with local timezone offset.
 * Example: "2026-05-09T14:30:00.000+03:00"
 * @param {Date} date
 * @returns {string}
 */
export function toISO8601(date) {
  if (!date || isNaN(date.getTime())) return "Invalid Date";
  // toISOString() always gives UTC (Z). We want local offset.
  const y   = date.getFullYear();
  const M   = pad(date.getMonth() + 1);
  const d   = pad(date.getDate());
  const H   = pad(date.getHours());
  const m   = pad(date.getMinutes());
  const s   = pad(date.getSeconds());
  const ms  = pad(date.getMilliseconds(), 3);
  const tz  = getUTCOffset(date);
  return `${y}-${M}-${d}T${H}:${m}:${s}.${ms}${tz}`;
}

/**
 * Format a Date as ISO 8601 UTC.
 * Example: "2026-05-09T11:30:00.000Z"
 * @param {Date} date
 * @returns {string}
 */
export function toISO8601UTC(date) {
  if (!date || isNaN(date.getTime())) return "Invalid Date";
  return date.toISOString();
}

/**
 * Format a Date as RFC 2822.
 * Example: "Sat, 09 May 2026 14:30:00 +0300"
 * @param {Date} date
 * @returns {string}
 */
export function toRFC2822(date) {
  if (!date || isNaN(date.getTime())) return "Invalid Date";
  const days   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dow = days[date.getDay()];
  const d   = pad(date.getDate());
  const mon = months[date.getMonth()];
  const y   = date.getFullYear();
  const H   = pad(date.getHours());
  const m   = pad(date.getMinutes());
  const s   = pad(date.getSeconds());
  const tz  = getUTCOffset(date, false);
  return `${dow}, ${d} ${mon} ${y} ${H}:${m}:${s} ${tz}`;
}

/**
 * Format a Date as a UTC string.
 * Example: "Sat, 09 May 2026 11:30:00 GMT"
 * @param {Date} date
 * @returns {string}
 */
export function toUTCString(date) {
  if (!date || isNaN(date.getTime())) return "Invalid Date";
  return date.toUTCString();
}

/**
 * Format a Date as a human-readable local string using Intl.
 * @param {Date} date
 * @param {string} [locale]
 * @param {"full"|"long"|"medium"|"short"} [dateStyle="long"]
 * @param {"full"|"long"|"medium"|"short"|null} [timeStyle="medium"]
 * @returns {string}
 */
export function toHumanReadable(
  date,
  locale,
  dateStyle = "long",
  timeStyle = "medium"
) {
  if (!date || isNaN(date.getTime())) return "Invalid Date";
  const opts = { dateStyle };
  if (timeStyle) opts.timeStyle = timeStyle;
  try {
    return _getCachedFmt(locale || undefined, opts).format(date);
  } catch (_) {
    return date.toString();
  }
}

/**
 * Format a Date as SQL datetime string.
 * Example: "2026-05-09 14:30:00"
 * @param {Date} date
 * @returns {string}
 */
export function toSQLDatetime(date) {
  if (!date || isNaN(date.getTime())) return "Invalid Date";
  return formatPattern(date, "YYYY-MM-DD HH:mm:ss");
}

// ── Full Conversion Result ────────────────────────────────────────────────────

/**
 * Generate all standard format outputs for a Date.
 * @param {Date} date
 * @param {string} [locale]
 * @returns {Object}
 */
export function getAllFormats(date, locale) {
  if (!date || isNaN(date.getTime())) {
    return { error: "Invalid Date" };
  }

  const unixSec = Math.floor(date.getTime() / 1000);
  const unixMs  = date.getTime();

  return {
    unixSeconds:      unixSec,
    unixMilliseconds: unixMs,
    iso8601:          toISO8601(date),
    iso8601utc:       toISO8601UTC(date),
    rfc2822:          toRFC2822(date),
    utcString:        toUTCString(date),
    localString:      toHumanReadable(date, locale, "long", "medium"),
    dateOnly:         formatPattern(date, "YYYY-MM-DD"),
    timeOnly:         formatPattern(date, "HH:mm:ss"),
    fullWeekday:      toHumanReadable(date, locale, "full", "full"),
    sqlDatetime:      toSQLDatetime(date),
    shortDate:        toHumanReadable(date, locale, "short", "short"),
    mediumDate:       toHumanReadable(date, locale, "medium", "medium"),
  };
}

// ── Developer Presets ─────────────────────────────────────────────────────────

/**
 * Generate developer-focused code snippets for a Date.
 * @param {Date} date
 * @returns {Array<{id: string, label: string, language: string, code: string}>}
 */
export function getDevPresets(date) {
  if (!date || isNaN(date.getTime())) return [];

  const unixSec  = Math.floor(date.getTime() / 1000);
  const unixMs   = date.getTime();
  const isoUtc   = date.toISOString();
  const isoLocal = toISO8601(date);
  const sql      = toSQLDatetime(date);

  return [
    {
      id: "js_date",
      label: "JavaScript (Date object)",
      language: "javascript",
      code: `new Date(${unixMs})`,
    },
    {
      id: "js_iso",
      label: "JavaScript (ISO string)",
      language: "javascript",
      code: `new Date("${isoUtc}")`,
    },
    {
      id: "js_unix",
      label: "JavaScript (Unix seconds)",
      language: "javascript",
      code: `Math.floor(Date.now() / 1000) // → ${unixSec}`,
    },
    {
      id: "python_datetime",
      label: "Python (datetime)",
      language: "python",
      code: `from datetime import datetime, timezone\ndatetime.fromtimestamp(${unixSec}, tz=timezone.utc)`,
    },
    {
      id: "python_unix",
      label: "Python (Unix timestamp)",
      language: "python",
      code: `import time\ntime.mktime(time.strptime("${sql}", "%Y-%m-%d %H:%M:%S"))`,
    },
    {
      id: "sql_datetime",
      label: "SQL (DATETIME literal)",
      language: "sql",
      code: `'${sql}'`,
    },
    {
      id: "sql_from_unix",
      label: "SQL (FROM_UNIXTIME)",
      language: "sql",
      code: `FROM_UNIXTIME(${unixSec})         -- MySQL\nTO_TIMESTAMP(${unixSec})            -- PostgreSQL`,
    },
    {
      id: "postgresql",
      label: "PostgreSQL (timestamptz)",
      language: "sql",
      code: `'${isoUtc}'::timestamptz`,
    },
    {
      id: "mongodb",
      label: "MongoDB (ISODate)",
      language: "javascript",
      code: `ISODate("${isoUtc}")`,
    },
    {
      id: "json",
      label: "JSON (ISO string field)",
      language: "json",
      code: `{ "timestamp": "${isoUtc}" }`,
    },
    {
      id: "json_unix",
      label: "JSON (Unix seconds field)",
      language: "json",
      code: `{ "timestamp": ${unixSec} }`,
    },
    {
      id: "rust",
      label: "Rust (chrono)",
      language: "rust",
      code: `DateTime::parse_from_rfc3339("${isoLocal}").unwrap()`,
    },
    {
      id: "go",
      label: "Go (time.Parse)",
      language: "go",
      code: `time.Parse(time.RFC3339, "${isoLocal}")`,
    },
    {
      id: "csharp",
      label: "C# (DateTimeOffset)",
      language: "csharp",
      code: `DateTimeOffset.FromUnixTimeSeconds(${unixSec});`,
    },
    {
      id: "java",
      label: "Java (Instant)",
      language: "java",
      code: `Instant.ofEpochSecond(${unixSec}L);`,
    },
    {
      id: "php",
      label: "PHP (DateTime)",
      language: "php",
      code: `new DateTime("${isoUtc}");\n// or:\ndate('Y-m-d H:i:s', ${unixSec});`,
    },
    {
      id: "ruby",
      label: "Ruby (Time)",
      language: "ruby",
      code: `Time.at(${unixSec}).utc`,
    },
    {
      id: "swift",
      label: "Swift (Date)",
      language: "swift",
      code: `Date(timeIntervalSince1970: ${unixSec})`,
    },
  ];
}

// ── Format Pattern Presets ────────────────────────────────────────────────────

/**
 * Pre-defined format patterns available in the Format Studio.
 * @returns {Array<{id: string, label: string, pattern: string, example: string}>}
 */
export function getFormatPresets() {
  return [
    { id: "iso_date",     label: "ISO Date",               pattern: "YYYY-MM-DD",                   example: "2026-05-09" },
    { id: "iso_datetime", label: "ISO Datetime (Local)",   pattern: "YYYY-MM-DDTHH:mm:ssZ",          example: "2026-05-09T14:30:00+03:00" },
    { id: "us_date",      label: "US Date",                pattern: "MM/DD/YYYY",                   example: "05/09/2026" },
    { id: "eu_date",      label: "EU Date",                pattern: "DD.MM.YYYY",                   example: "09.05.2026" },
    { id: "uk_date",      label: "UK Date",                pattern: "DD/MM/YYYY",                   example: "09/05/2026" },
    { id: "full_date",    label: "Full Date",              pattern: "DDDD, MMMM Do YYYY",            example: "Saturday, May 9th 2026" },
    { id: "short_date",   label: "Short Date",             pattern: "MMM D, YYYY",                  example: "May 9, 2026" },
    { id: "time_24",      label: "Time (24h)",             pattern: "HH:mm:ss",                     example: "14:30:00" },
    { id: "time_12",      label: "Time (12h)",             pattern: "h:mm:ss A",                    example: "2:30:00 PM" },
    { id: "datetime_24",  label: "Datetime (24h)",         pattern: "YYYY-MM-DD HH:mm:ss",          example: "2026-05-09 14:30:00" },
    { id: "datetime_12",  label: "Datetime (12h)",         pattern: "MMM D YYYY, h:mm A",           example: "May 9 2026, 2:30 PM" },
    { id: "unix_sec",     label: "Unix (Seconds)",         pattern: "X",                            example: "1746823501" },
    { id: "unix_ms",      label: "Unix (Milliseconds)",   pattern: "x",                            example: "1746823501000" },
    { id: "with_week",    label: "Date + Week Number",    pattern: "YYYY-[W]WW-D",                 example: "2026-W19-6" },
    { id: "quarter",      label: "Year + Quarter",         pattern: "YYYY [Q]Q",                    example: "2026 Q2" },
    { id: "log_stamp",    label: "Log Timestamp",          pattern: "YYYY-MM-DD HH:mm:ss.SSS",      example: "2026-05-09 14:30:00.123" },
    { id: "filename",     label: "Filename-Safe",          pattern: "YYYY-MM-DD_HH-mm-ss",          example: "2026-05-09_14-30-00" },
    { id: "rfc2822",      label: "RFC 2822",               pattern: null,                           example: "Sat, 09 May 2026 14:30:00 +0300" },
  ];
}

// ── Intl.DateTimeFormat Wrapper ───────────────────────────────────────────────

/**
 * Format a Date using Intl.DateTimeFormat with given options.
 * @param {Date} date
 * @param {string} [locale]
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatIntl(date, locale, options = {}) {
  if (!date || isNaN(date.getTime())) return "Invalid Date";
  try {
    return _getCachedFmt(locale || undefined, options).format(date);
  } catch (_) {
    return date.toString();
  }
}

/**
 * Format a Date's individual parts using Intl.DateTimeFormat.formatToParts.
 * @param {Date} date
 * @param {string} [locale]
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {Object} - keyed by part type
 */
export function formatToParts(date, locale, options = {}) {
  if (!date || isNaN(date.getTime())) return {};
  try {
    const fmt = _getCachedFmt(locale || undefined, options);
    const parts = fmt.formatToParts(date);
    return parts.reduce((acc, { type, value }) => {
      acc[type] = value;
      return acc;
    }, {});
  } catch (_) {
    return {};
  }
}