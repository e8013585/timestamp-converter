/**
 * relativeTime.js
 * Relative time and time difference module for Timestamp Converter.
 *
 * Provides:
 *   - Human-readable relative time ("2 hours ago", "in 3 days")
 *   - Precise time difference breakdown (years, months, days, hours, minutes, seconds)
 *   - Countdown timer formatting
 *   - Elapsed time formatting
 *   - Intl.RelativeTimeFormat integration with locale support
 *   - Manual fallback for locales without full Intl.RelativeTimeFormat support
 *
 * All functions are pure — no DOM access, no side effects.
 */

import { MS, dateDiff } from "./utils.js";

// ── Intl.RelativeTimeFormat Cache ─────────────────────────────────────────────

const _rtfCache = new Map();

function _getRTF(locale, options = {}) {
  const key = `${locale}|${JSON.stringify(options)}`;
  if (!_rtfCache.has(key)) {
    try {
      _rtfCache.set(
        key,
        new Intl.RelativeTimeFormat(locale || undefined, {
          numeric: "auto",
          style: "long",
          ...options,
        })
      );
    } catch (_) {
      // Fallback: use English
      _rtfCache.set(
        key,
        new Intl.RelativeTimeFormat("en", {
          numeric: "auto",
          style: "long",
          ...options,
        })
      );
    }
  }
  return _rtfCache.get(key);
}

// ── Threshold Table ───────────────────────────────────────────────────────────
// Defines how we pick the most meaningful relative time unit.
// Each entry: { unit, msThreshold, divisor }
// We use the first unit whose threshold the diff exceeds.

const THRESHOLDS = [
  { unit: "second", threshold: MS.MINUTE,        divisor: 1000 },
  { unit: "minute", threshold: MS.HOUR,           divisor: MS.MINUTE },
  { unit: "hour",   threshold: MS.DAY,            divisor: MS.HOUR },
  { unit: "day",    threshold: MS.WEEK * 2,       divisor: MS.DAY },
  { unit: "week",   threshold: MS.MONTH * 2,      divisor: MS.WEEK },
  { unit: "month",  threshold: MS.YEAR,           divisor: MS.MONTH },
  { unit: "year",   threshold: Infinity,           divisor: MS.YEAR },
];

// ── Core: Relative Time ───────────────────────────────────────────────────────

/**
 * Format a Date relative to now (or a reference date).
 * Uses Intl.RelativeTimeFormat for locale-aware output.
 *
 * @param {Date} date           - The target date
 * @param {string} [locale]     - BCP 47 locale string
 * @param {Date} [reference]    - Reference point (defaults to now)
 * @param {"long"|"short"|"narrow"} [style="long"]
 * @returns {string}            - e.g. "2 hours ago", "in 3 days", "yesterday"
 */
export function toRelativeTime(date, locale, reference, style = "long") {
  if (!date || isNaN(date.getTime())) return "Invalid Date";

  const ref = reference instanceof Date && !isNaN(reference.getTime())
    ? reference
    : new Date();

  const diffMs = date.getTime() - ref.getTime();
  const absMs  = Math.abs(diffMs);

  // "just now" threshold — within 2 seconds
  if (absMs < 2000) {
    try {
      const rtf = _getRTF(locale, { numeric: "auto", style });
      return rtf.format(0, "second");
    } catch (_) {
      return "just now";
    }
  }

  // Find the best unit
  let unit = "second";
  let value = Math.round(diffMs / 1000);

  for (const entry of THRESHOLDS) {
    if (absMs < entry.threshold) {
      unit  = entry.unit;
      value = Math.round(diffMs / entry.divisor);
      break;
    }
  }

  try {
    const rtf = _getRTF(locale, { numeric: "auto", style });
    return rtf.format(value, unit);
  } catch (_) {
    // Manual English fallback
    return _manualRelative(value, unit);
  }
}

/**
 * Manual English fallback for Intl.RelativeTimeFormat.
 * @param {number} value - signed value
 * @param {string} unit
 * @returns {string}
 */
function _manualRelative(value, unit) {
  const abs  = Math.abs(value);
  const past = value < 0;
  const plural = abs !== 1 ? "s" : "";

  const unitLabel = `${abs} ${unit}${plural}`;

  if (unit === "second" && abs < 2) return "just now";
  return past ? `${unitLabel} ago` : `in ${unitLabel}`;
}

// ── Precise Difference ────────────────────────────────────────────────────────

/**
 * Get a full, precise breakdown of the difference between two dates.
 *
 * @param {Date} dateA
 * @param {Date} dateB
 * @param {string} [locale]
 * @returns {PreciseDiff}
 */
export function getPreciseDiff(dateA, dateB, locale) {
  if (!dateA || !dateB || isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
    return null;
  }

  const diff = dateDiff(dateA, dateB);
  const isFuture = diff.sign > 0;

  // Build a human-readable summary string
  const parts = [];
  if (diff.years  > 0) parts.push(_pluralise(diff.years,  "year",   locale));
  if (diff.months % 12 > 0) parts.push(_pluralise(diff.months % 12, "month", locale));

  // Remaining days after subtracting full months
  const [earlier, later] = isFuture ? [dateA, dateB] : [dateB, dateA];
  const remainingDays = _remainingDays(earlier, later);
  if (remainingDays > 0) parts.push(_pluralise(remainingDays, "day", locale));

  // Hours, minutes, seconds from raw ms
  const remainingMs = diff.ms
    - diff.years  * MS.YEAR
    - (diff.months % 12) * MS.MONTH
    - remainingDays * MS.DAY;
  const remH = Math.floor(Math.abs(remainingMs) / MS.HOUR);
  const remM = Math.floor((Math.abs(remainingMs) % MS.HOUR) / MS.MINUTE);
  const remS = Math.floor((Math.abs(remainingMs) % MS.MINUTE) / 1000);

  if (remH > 0) parts.push(_pluralise(remH, "hour",   locale));
  if (remM > 0) parts.push(_pluralise(remM, "minute", locale));
  if (remS > 0) parts.push(_pluralise(remS, "second", locale));

  const summary = parts.length > 0 ? parts.join(", ") : "0 seconds";

  return {
    // Raw totals
    totalMs:      diff.ms,
    totalSeconds: diff.seconds,
    totalMinutes: diff.minutes,
    totalHours:   diff.hours,
    totalDays:    diff.days,
    totalWeeks:   Math.floor(diff.days / 7),
    totalMonths:  diff.months,
    totalYears:   diff.years,

    // Component breakdown
    years:        diff.years,
    months:       diff.months % 12,
    days:         remainingDays,
    hours:        remH,
    minutes:      remM,
    seconds:      remS,

    // Direction
    isFuture,
    isPast: !isFuture,
    sign: diff.sign,

    // Formatted
    summary,
    humanSummary: isFuture
      ? `in ${summary}`
      : `${summary} ago`,
  };
}

/**
 * Calculate remaining days between two dates after accounting for
 * full calendar months elapsed.
 */
function _remainingDays(earlier, later) {
  const months =
    (later.getFullYear() - earlier.getFullYear()) * 12 +
    (later.getMonth() - earlier.getMonth());

  const afterMonths = new Date(earlier);
  afterMonths.setMonth(afterMonths.getMonth() + months);

  const remainingMs = later.getTime() - afterMonths.getTime();
  return Math.floor(remainingMs / MS.DAY);
}

/**
 * Produce a pluralised unit string, using Intl if available.
 * @param {number} n
 * @param {string} unit  - "year" | "month" | "day" | "hour" | "minute" | "second"
 * @param {string} [locale]
 * @returns {string}
 */
function _pluralise(n, unit, locale) {
  try {
    // Use Intl.RelativeTimeFormat to get the unit name in context
    const rtf = _getRTF(locale, { numeric: "always", style: "long" });
    // format(n, unit) gives e.g. "in 3 days" — extract just "3 days"
    const raw = rtf.format(n, unit);
    // Strip directional words ("in", "ago", etc.) — keep the numeric part
    return raw
      .replace(/^in\s+/i, "")
      .replace(/\s+ago$/i, "")
      .trim();
  } catch (_) {
    // Fallback English
    return `${n} ${unit}${n !== 1 ? "s" : ""}`;
  }
}

// ── Countdown Formatter ───────────────────────────────────────────────────────

/**
 * Format a countdown from now to a future date.
 * Returns structured object and formatted strings.
 *
 * @param {Date} targetDate
 * @returns {CountdownResult|null}
 */
export function formatCountdown(targetDate) {
  if (!targetDate || isNaN(targetDate.getTime())) return null;

  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();
  const isPast = diffMs < 0;
  const abs = Math.abs(diffMs);

  const days    = Math.floor(abs / MS.DAY);
  const hours   = Math.floor((abs % MS.DAY)    / MS.HOUR);
  const minutes = Math.floor((abs % MS.HOUR)   / MS.MINUTE);
  const seconds = Math.floor((abs % MS.MINUTE) / 1000);
  const ms      = abs % 1000;

  // Compact HH:MM:SS style
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  const compact = days > 0
    ? `${days}d ${hh}:${mm}:${ss}`
    : `${hh}:${mm}:${ss}`;

  // Verbose style: "3 days, 4 hours, 12 minutes, 5 seconds"
  const verboseParts = [];
  if (days    > 0) verboseParts.push(`${days}d`);
  if (hours   > 0) verboseParts.push(`${hours}h`);
  if (minutes > 0) verboseParts.push(`${minutes}m`);
  verboseParts.push(`${seconds}s`);

  return {
    isPast,
    isFuture: !isPast,
    totalMs: abs,
    days,
    hours,
    minutes,
    seconds,
    milliseconds: ms,
    compact,
    verbose: verboseParts.join(" "),
  };
}

// ── Elapsed Time ──────────────────────────────────────────────────────────────

/**
 * Format time elapsed since a past date.
 * @param {Date} pastDate
 * @param {string} [locale]
 * @returns {string}  - e.g. "Elapsed: 3 days, 4 hours, 12 minutes"
 */
export function formatElapsed(pastDate, locale) {
  if (!pastDate || isNaN(pastDate.getTime())) return "Invalid Date";
  const now = new Date();
  const diff = getPreciseDiff(pastDate, now, locale);
  if (!diff) return "Invalid Date";
  return diff.summary;
}

// ── Time Difference Table ─────────────────────────────────────────────────────

/**
 * Generate a full comparison table between two dates/timestamps.
 * Suitable for rendering in the Time Difference Calculator UI.
 *
 * @param {Date} dateA
 * @param {Date} dateB
 * @param {string} [locale]
 * @returns {DiffTable|null}
 */
export function getDiffTable(dateA, dateB, locale) {
  if (
    !dateA || !dateB ||
    isNaN(dateA.getTime()) || isNaN(dateB.getTime())
  ) return null;

  const diff = getPreciseDiff(dateA, dateB, locale);
  if (!diff) return null;

  const rtf = _getRTF(locale, { numeric: "always", style: "long" });

  // Format each total using Intl where possible
  function fmt(n, unit) {
    try {
      return rtf
        .format(diff.sign * n, unit)
        .replace(/^in\s+/i, "")
        .replace(/\s+ago$/i, "")
        .trim();
    } catch (_) {
      return `${n} ${unit}${n !== 1 ? "s" : ""}`;
    }
  }

  return {
    ...diff,
    rows: [
      {
        unit:     "years",
        labelKey: "utilDiffYears",
        total:    diff.totalYears,
        display:  diff.totalYears.toLocaleString(locale),
      },
      {
        unit:     "months",
        labelKey: "utilDiffMonths",
        total:    diff.totalMonths,
        display:  diff.totalMonths.toLocaleString(locale),
      },
      {
        unit:     "days",
        labelKey: "utilDiffDays",
        total:    diff.totalDays,
        display:  diff.totalDays.toLocaleString(locale),
      },
      {
        unit:     "hours",
        labelKey: "utilDiffHours",
        total:    diff.totalHours,
        display:  diff.totalHours.toLocaleString(locale),
      },
      {
        unit:     "minutes",
        labelKey: "utilDiffMinutes",
        total:    diff.totalMinutes,
        display:  diff.totalMinutes.toLocaleString(locale),
      },
      {
        unit:     "seconds",
        labelKey: "utilDiffSeconds",
        total:    diff.totalSeconds,
        display:  diff.totalSeconds.toLocaleString(locale),
      },
    ],
    humanSummary: diff.humanSummary,
  };
}

// ── Relative Time for Lists ───────────────────────────────────────────────────

/**
 * Format multiple dates relative to now in batch.
 * Useful for history lists, batch results, etc.
 *
 * @param {Date[]} dates
 * @param {string} [locale]
 * @returns {string[]}
 */
export function batchRelative(dates, locale) {
  const now = new Date();
  return dates.map((d) => {
    if (!d || isNaN(d.getTime())) return "Invalid";
    return toRelativeTime(d, locale, now);
  });
}

// ── Live Ticker ───────────────────────────────────────────────────────────────

/**
 * Create a live-updating relative time ticker.
 * Calls callback with updated string every `interval` ms.
 * Returns a stop function.
 *
 * @param {Date} date
 * @param {Function} callback  - called with (relativeString, date)
 * @param {string} [locale]
 * @param {number} [interval=1000]
 * @returns {Function}  - call to stop the ticker
 */
export function createLiveTicker(date, callback, locale, interval = 1000) {
  if (!date || isNaN(date.getTime())) {
    callback("Invalid Date", date);
    return () => {};
  }

  let timerId;

  function tick() {
    const rel = toRelativeTime(date, locale);
    callback(rel, date);

    // Adaptive interval: use longer intervals for far-away dates
    const diffMs = Math.abs(Date.now() - date.getTime());
    let nextInterval = interval;
    if (diffMs > MS.DAY)   nextInterval = 60000;   // 1 minute
    else if (diffMs > MS.HOUR)  nextInterval = 10000;  // 10 seconds
    else if (diffMs > MS.MINUTE) nextInterval = 1000;  // 1 second

    timerId = setTimeout(tick, nextInterval);
  }

  tick();

  return function stop() {
    clearTimeout(timerId);
  };
}

// ── Epoch Info ────────────────────────────────────────────────────────────────

/**
 * Get informational data about a timestamp relative to key epoch events.
 * Used by the Epoch Explorer panel.
 *
 * @param {Date} date
 * @param {string} [locale]
 * @returns {EpochInfo}
 */
export function getEpochInfo(date, locale) {
  if (!date || isNaN(date.getTime())) return null;

  const UNIX_EPOCH = new Date(0);            // 1970-01-01
  const Y2038      = new Date(2147483647000); // 2038-01-19T03:14:07Z
  const Y2K        = new Date(2000, 0, 1);   // 2000-01-01
  const now        = new Date();

  return {
    sinceEpoch:     getPreciseDiff(UNIX_EPOCH, date, locale),
    sinceEpochRel:  toRelativeTime(UNIX_EPOCH, locale, date),
    toY2038:        getPreciseDiff(date, Y2038, locale),
    toY2038Rel:     toRelativeTime(Y2038, locale, date),
    sinceY2K:       getPreciseDiff(Y2K, date, locale),
    sinceNow:       getPreciseDiff(now, date, locale),
    isBeforeEpoch:  date.getTime() < 0,
    isAfterY2038:   date.getTime() > Y2038.getTime(),
    isBeforeY2K:    date.getTime() < Y2K.getTime(),
    unixSeconds:    Math.floor(date.getTime() / 1000),
    precision:      _detectPrecisionLabel(date),
  };
}

/**
 * Get a descriptive precision label for a timestamp value.
 * @param {Date} date
 * @returns {string}
 */
function _detectPrecisionLabel(date) {
  const ms = date.getTime();
  const absStr = String(Math.abs(ms));

  if (absStr.length <= 11)  return "epochPrecisionSeconds";
  if (absStr.length <= 13)  return "epochPrecisionMilliseconds";
  if (absStr.length <= 16)  return "epochPrecisionMicroseconds";
  return "epochPrecisionNanoseconds";
}