/**
 * parser.js
 * Smart date/timestamp parser for Timestamp Converter.
 *
 * Handles:
 *   - Unix timestamps (seconds & milliseconds)
 *   - ISO 8601 strings
 *   - RFC 2822 strings
 *   - Human-readable dates ("May 9 2026", "9 May 2026")
 *   - Relative expressions ("now", "today", "yesterday", "tomorrow")
 *   - Natural language offsets ("in 3 days", "2 hours ago", "next Friday")
 *   - SQL datetime strings ("2026-05-09 14:30:00")
 *   - Partial dates ("2026-05", "05/2026")
 *
 * No external libraries — pure JS + native Date APIs.
 *
 * All parse functions return a ParseResult object:
 * {
 *   date: Date | null,
 *   type: string,          // detected input type key
 *   confidence: "high" | "medium" | "low",
 *   originalInput: string,
 *   normalised: string,    // cleaned input string
 *   error: string | null,
 * }
 */

import { isValidDate, isInRange, MS } from "./utils.js";

// ── Result Factories ──────────────────────────────────────────────────────────

function makeResult(overrides) {
  return {
    date: null,
    type: "unknown",
    confidence: "low",
    originalInput: "",
    normalised: "",
    error: null,
    ...overrides,
  };
}

function errorResult(originalInput, error) {
  return makeResult({ originalInput, normalised: originalInput, error });
}

// ── Detection Type Constants ──────────────────────────────────────────────────

export const INPUT_TYPES = {
  UNIX_SECONDS:      "detectedUnixSec",
  UNIX_MILLISECONDS: "detectedUnixMs",
  ISO_8601:          "detectedIso",
  RFC_2822:          "detectedRfc",
  HUMAN_READABLE:    "detectedHuman",
  RELATIVE:          "detectedRelative",
  UNKNOWN:           "detectedUnknown",
};

// ── Regex Library ─────────────────────────────────────────────────────────────

const RX = {
  // Pure integer (possibly negative), optional surrounding whitespace
  INTEGER:       /^\s*-?\d+\s*$/,

  // Decimal numbers (for floats like 1746823501.5)
  DECIMAL:       /^\s*-?\d+(\.\d+)?\s*$/,

  // ISO 8601 — covers date-only, datetime with T, with/without timezone
  ISO_FULL: /^\s*(-?\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(?:(Z)|([+-]\d{2}:?\d{2}))?)?\s*$/i,

  // ISO week date: 2026-W19-5
  ISO_WEEK:      /^\s*(\d{4})-W(\d{2})-?(\d)?\s*$/i,

  // ISO ordinal: 2026-130
  ISO_ORDINAL:   /^\s*(\d{4})-(\d{3})\s*$/,

  // RFC 2822: "Thu, 09 May 2026 14:30:00 +0000"
  RFC_2822:      /^\s*(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+)?\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:[+-]\d{4}|UTC|GMT|Z)\s*$/i,

  // SQL datetime: "2026-05-09 14:30:00" or "2026-05-09 14:30"
  SQL_DATETIME:  /^\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*$/,

  // US date: MM/DD/YYYY or MM-DD-YYYY
  US_DATE:       /^\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s*$/,

  // EU date: DD.MM.YYYY
  EU_DATE:       /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/,

  // Partial ISO year-month: 2026-05
  PARTIAL_YM:    /^\s*(\d{4})-(\d{2})\s*$/,

  // Month name + day + optional year: "May 9", "May 9 2026", "9 May 2026"
  MONTH_NAME:    /^\s*(?:(\d{1,2})\s+)?([A-Za-z]+)(?:\s+(\d{1,2}))?,?\s*(\d{4})?\s*$/,

  // Time-only: "14:30", "14:30:00", "2:30 PM"
  TIME_ONLY:     /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\s*$/i,
};

// ── Month Helpers ─────────────────────────────────────────────────────────────

const MONTH_NAMES = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

const DAY_NAMES = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

function monthIndex(name) {
  return MONTH_NAMES[name.toLowerCase()] ?? -1;
}

function dayIndex(name) {
  return DAY_NAMES[name.toLowerCase()] ?? -1;
}

// ── Individual Parsers ────────────────────────────────────────────────────────

/**
 * Try to parse as a Unix timestamp (integer seconds or milliseconds).
 */
function parseUnixTimestamp(input, originalInput) {
  if (!RX.DECIMAL.test(input)) return null;

  const num = parseFloat(input);
  if (!Number.isFinite(num)) return null;

  const absStr = String(Math.floor(Math.abs(num)));
  const digits = absStr.length;

  let ms, type, confidence;

  if (digits <= 11) {
    // Treat as seconds
    ms = Math.round(num * 1000);
    type = INPUT_TYPES.UNIX_SECONDS;
    confidence = digits >= 9 ? "high" : "medium";
  } else if (digits <= 14) {
    // Treat as milliseconds
    ms = Math.round(num);
    type = INPUT_TYPES.UNIX_MILLISECONDS;
    confidence = "high";
  } else {
    // Could be microseconds or nanoseconds — treat as ms with low confidence
    ms = Math.round(num / Math.pow(10, digits - 13));
    type = INPUT_TYPES.UNIX_MILLISECONDS;
    confidence = "low";
  }

  const date = new Date(ms);
  if (!isValidDate(date) || !isInRange(ms)) return null;

  return makeResult({
    date,
    type,
    confidence,
    originalInput,
    normalised: input.trim(),
  });
}

/**
 * Try to parse as ISO 8601.
 */
function parseISO8601(input, originalInput) {
  const m = input.match(RX.ISO_FULL);
  if (!m) return null;

  const [, year, month, day, hour, min, sec, frac, isZ, tzOffset] = m;

  // Build a normalised ISO string
  let iso = `${year}-${month}-${day}`;
  if (hour !== undefined) {
    iso += `T${hour}:${min || "00"}:${sec || "00"}`;
    if (frac) iso += `.${frac.slice(0, 3).padEnd(3, "0")}`;
    if (isZ) iso += "Z";
    else if (tzOffset) iso += tzOffset.replace(":", "").replace(/(\d{2})(\d{2})$/, "$1:$2");
    // No TZ = local time (ambiguous, treat as local)
  }

  const date = new Date(iso);
  if (!isValidDate(date)) return null;

  return makeResult({
    date,
    type: INPUT_TYPES.ISO_8601,
    confidence: "high",
    originalInput,
    normalised: iso,
  });
}

/**
 * Try to parse ISO week date (2026-W19-5).
 */
function parseISOWeek(input, originalInput) {
  const m = input.match(RX.ISO_WEEK);
  if (!m) return null;

  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  const dayOfWeek = m[3] ? parseInt(m[3], 10) : 1; // default Monday

  // Jan 4 is always in week 1
  const jan4 = new Date(year, 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));

  const date = new Date(startOfWeek1);
  date.setDate(startOfWeek1.getDate() + (week - 1) * 7 + (dayOfWeek - 1));

  if (!isValidDate(date)) return null;

  return makeResult({
    date,
    type: INPUT_TYPES.ISO_8601,
    confidence: "high",
    originalInput,
    normalised: input.trim(),
  });
}

/**
 * Try to parse ISO ordinal date (2026-130).
 */
function parseISOOrdinal(input, originalInput) {
  const m = input.match(RX.ISO_ORDINAL);
  if (!m) return null;

  const year = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);

  const date = new Date(year, 0, day);
  if (!isValidDate(date) || date.getFullYear() !== year) return null;

  return makeResult({
    date,
    type: INPUT_TYPES.ISO_8601,
    confidence: "high",
    originalInput,
    normalised: input.trim(),
  });
}

/**
 * Try to parse RFC 2822.
 */
function parseRFC2822(input, originalInput) {
  if (!RX.RFC_2822.test(input)) return null;

  const date = new Date(input.trim());
  if (!isValidDate(date)) return null;

  return makeResult({
    date,
    type: INPUT_TYPES.RFC_2822,
    confidence: "high",
    originalInput,
    normalised: input.trim(),
  });
}

/**
 * Try to parse SQL datetime ("2026-05-09 14:30:00").
 */
function parseSQLDatetime(input, originalInput) {
  const m = input.match(RX.SQL_DATETIME);
  if (!m) return null;

  const [, year, month, day, hour, min, sec = "00"] = m;
  // Convert to ISO (treat as local)
  const iso = `${year}-${month}-${day}T${hour}:${min}:${sec}`;
  const date = new Date(iso);
  if (!isValidDate(date)) return null;

  return makeResult({
    date,
    type: INPUT_TYPES.HUMAN_READABLE,
    confidence: "high",
    originalInput,
    normalised: iso,
  });
}

/**
 * Try to parse US-style date (MM/DD/YYYY or MM-DD-YYYY).
 */
function parseUSDate(input, originalInput) {
  const m = input.match(RX.US_DATE);
  if (!m) return null;

  const month = parseInt(m[1], 10) - 1;
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);

  if (month < 0 || month > 11 || day < 1 || day > 31) return null;

  const date = new Date(year, month, day);
  if (!isValidDate(date)) return null;

  return makeResult({
    date,
    type: INPUT_TYPES.HUMAN_READABLE,
    confidence: "medium",
    originalInput,
    normalised: input.trim(),
  });
}

/**
 * Try to parse EU-style date (DD.MM.YYYY).
 */
function parseEUDate(input, originalInput) {
  const m = input.match(RX.EU_DATE);
  if (!m) return null;

  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const year = parseInt(m[3], 10);

  if (month < 0 || month > 11 || day < 1 || day > 31) return null;

  const date = new Date(year, month, day);
  if (!isValidDate(date)) return null;

  return makeResult({
    date,
    type: INPUT_TYPES.HUMAN_READABLE,
    confidence: "medium",
    originalInput,
    normalised: input.trim(),
  });
}

/**
 * Try to parse partial year-month ("2026-05" → May 1, 2026).
 */
function parsePartialYearMonth(input, originalInput) {
  const m = input.match(RX.PARTIAL_YM);
  if (!m) return null;

  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  if (month < 0 || month > 11) return null;

  const date = new Date(year, month, 1);
  if (!isValidDate(date)) return null;

  return makeResult({
    date,
    type: INPUT_TYPES.HUMAN_READABLE,
    confidence: "medium",
    originalInput,
    normalised: input.trim(),
  });
}

/**
 * Try to parse month-name based dates.
 * Handles: "May 9 2026", "9 May 2026", "May 9", "9 May", "May 2026"
 */
function parseMonthName(input, originalInput) {
  const cleaned = input.trim();

  // Try "Month DD, YYYY" or "Month DD YYYY" or "DD Month YYYY" variations
  // Pattern: optional day, month name, optional day, optional year
  const patterns = [
    // "May 9 2026" or "May 9, 2026"
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
    // "9 May 2026"
    /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/,
    // "May 2026" (no day)
    /^([A-Za-z]+)\s+(\d{4})$/,
    // "May 9" (no year — use current year)
    /^([A-Za-z]+)\s+(\d{1,2})$/,
    // "9 May" (no year)
    /^(\d{1,2})\s+([A-Za-z]+)$/,
    // "May 9th 2026" (ordinal suffix)
    /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th),?\s+(\d{4})$/i,
    // "9th May 2026"
    /^(\d{1,2})(?:st|nd|rd|th)\s+([A-Za-z]+)\s+(\d{4})$/i,
  ];

  const now = new Date();
  let month = -1, day = 1, year = now.getFullYear();

  // Pattern 0: "May 9 2026"
  let m = cleaned.match(patterns[0]);
  if (m) {
    month = monthIndex(m[1]);
    day = parseInt(m[2], 10);
    year = parseInt(m[3], 10);
  }

  // Pattern 1: "9 May 2026"
  if (month === -1) {
    m = cleaned.match(patterns[1]);
    if (m) {
      day = parseInt(m[1], 10);
      month = monthIndex(m[2]);
      year = parseInt(m[3], 10);
    }
  }

  // Pattern 2: "May 2026"
  if (month === -1) {
    m = cleaned.match(patterns[2]);
    if (m) {
      month = monthIndex(m[1]);
      year = parseInt(m[2], 10);
      day = 1;
    }
  }

  // Pattern 3: "May 9" (current year)
  if (month === -1) {
    m = cleaned.match(patterns[3]);
    if (m) {
      month = monthIndex(m[1]);
      day = parseInt(m[2], 10);
    }
  }

  // Pattern 4: "9 May" (current year)
  if (month === -1) {
    m = cleaned.match(patterns[4]);
    if (m) {
      day = parseInt(m[1], 10);
      month = monthIndex(m[2]);
    }
  }

  // Pattern 5: "May 9th 2026"
  if (month === -1) {
    m = cleaned.match(patterns[5]);
    if (m) {
      month = monthIndex(m[1]);
      day = parseInt(m[2], 10);
      year = parseInt(m[3], 10);
    }
  }

  // Pattern 6: "9th May 2026"
  if (month === -1) {
    m = cleaned.match(patterns[6]);
    if (m) {
      day = parseInt(m[1], 10);
      month = monthIndex(m[2]);
      year = parseInt(m[3], 10);
    }
  }

  if (month === -1) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(year, month, day);
  if (!isValidDate(date)) return null;

  return makeResult({
    date,
    type: INPUT_TYPES.HUMAN_READABLE,
    confidence: "medium",
    originalInput,
    normalised: cleaned,
  });
}

/**
 * Try to parse relative / natural language expressions.
 *
 * Supports:
 *   "now", "today", "yesterday", "tomorrow"
 *   "N seconds/minutes/hours/days/weeks/months/years ago"
 *   "in N seconds/minutes/hours/days/weeks/months/years"
 *   "next/last Monday…Sunday"
 *   "next/last week/month/year"
 *   "start of day/week/month/year"
 *   "end of day/week/month/year"
 */
function parseRelative(input, originalInput) {
  const raw = input.trim().toLowerCase();
  const now = new Date();

  // ── Simple keywords ──
  if (raw === "now") {
    return makeResult({
      date: now,
      type: INPUT_TYPES.RELATIVE,
      confidence: "high",
      originalInput,
      normalised: "now",
    });
  }

  if (raw === "today") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return makeResult({
      date: d,
      type: INPUT_TYPES.RELATIVE,
      confidence: "high",
      originalInput,
      normalised: "today",
    });
  }

  if (raw === "yesterday") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return makeResult({
      date: d,
      type: INPUT_TYPES.RELATIVE,
      confidence: "high",
      originalInput,
      normalised: "yesterday",
    });
  }

  if (raw === "tomorrow") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return makeResult({
      date: d,
      type: INPUT_TYPES.RELATIVE,
      confidence: "high",
      originalInput,
      normalised: "tomorrow",
    });
  }

  // ── "N unit ago" / "in N unit" ──
  const agoMatch = raw.match(
    /^(\d+(?:\.\d+)?)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/
  );
  if (agoMatch) {
    const n = parseFloat(agoMatch[1]);
    const unit = agoMatch[2];
    const date = _offsetDate(now, -n, unit);
    if (date) {
      return makeResult({
        date,
        type: INPUT_TYPES.RELATIVE,
        confidence: "high",
        originalInput,
        normalised: raw,
      });
    }
  }

  const inMatch = raw.match(
    /^in\s+(\d+(?:\.\d+)?)\s+(second|minute|hour|day|week|month|year)s?$/
  );
  if (inMatch) {
    const n = parseFloat(inMatch[1]);
    const unit = inMatch[2];
    const date = _offsetDate(now, n, unit);
    if (date) {
      return makeResult({
        date,
        type: INPUT_TYPES.RELATIVE,
        confidence: "high",
        originalInput,
        normalised: raw,
      });
    }
  }

  // ── "next/last <weekday>" ──
  const nextLastDay = raw.match(/^(next|last)\s+([a-z]+)$/);
  if (nextLastDay) {
    const dir = nextLastDay[1] === "next" ? 1 : -1;
    const target = dayIndex(nextLastDay[2]);

    if (target !== -1) {
      const current = now.getDay();
      let diff = (target - current + 7) % 7 || 7;
      if (dir === -1) diff = diff === 7 ? 0 : -(7 - diff);
      const d = new Date(now);
      d.setDate(now.getDate() + dir * diff);
      d.setHours(0, 0, 0, 0);
      return makeResult({
        date: d,
        type: INPUT_TYPES.RELATIVE,
        confidence: "high",
        originalInput,
        normalised: raw,
      });
    }

    // "next/last week/month/year"
    if (nextLastDay[2] === "week") {
      const d = new Date(now);
      d.setDate(now.getDate() + dir * 7);
      d.setHours(0, 0, 0, 0);
      return makeResult({
        date: d,
        type: INPUT_TYPES.RELATIVE,
        confidence: "high",
        originalInput,
        normalised: raw,
      });
    }

    if (nextLastDay[2] === "month") {
      const d = new Date(now.getFullYear(), now.getMonth() + dir, 1);
      return makeResult({
        date: d,
        type: INPUT_TYPES.RELATIVE,
        confidence: "high",
        originalInput,
        normalised: raw,
      });
    }

    if (nextLastDay[2] === "year") {
      const d = new Date(now.getFullYear() + dir, 0, 1);
      return makeResult({
        date: d,
        type: INPUT_TYPES.RELATIVE,
        confidence: "high",
        originalInput,
        normalised: raw,
      });
    }
  }

  // ── "next <weekday> at <time>" ──
  const nextDayAt = raw.match(
    /^(next|last)\s+([a-z]+)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/
  );
  if (nextDayAt) {
    const dir = nextDayAt[1] === "next" ? 1 : -1;
    const target = dayIndex(nextDayAt[2]);
    if (target !== -1) {
      let hours = parseInt(nextDayAt[3], 10);
      const mins = parseInt(nextDayAt[4] || "0", 10);
      const ampm = nextDayAt[5];
      if (ampm === "pm" && hours < 12) hours += 12;
      if (ampm === "am" && hours === 12) hours = 0;

      const current = now.getDay();
      let diff = (target - current + 7) % 7 || 7;
      if (dir === -1) diff = -(7 - diff);

      const d = new Date(now);
      d.setDate(now.getDate() + dir * Math.abs(diff));
      d.setHours(hours, mins, 0, 0);

      return makeResult({
        date: d,
        type: INPUT_TYPES.RELATIVE,
        confidence: "high",
        originalInput,
        normalised: raw,
      });
    }
  }

  // ── "today at HH:mm" ──
  const todayAt = raw.match(
    /^today\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/
  );
  if (todayAt) {
    let hours = parseInt(todayAt[1], 10);
    const mins = parseInt(todayAt[2] || "0", 10);
    const ampm = todayAt[3];
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, mins, 0, 0);
    return makeResult({
      date: d,
      type: INPUT_TYPES.RELATIVE,
      confidence: "high",
      originalInput,
      normalised: raw,
    });
  }

  // ── "start/end of day/week/month/year" ──
  const boundary = raw.match(/^(start|end)\s+of\s+(day|week|month|year)$/);
  if (boundary) {
    const which = boundary[1];
    const unit = boundary[2];
    const d = _boundary(now, which, unit);
    if (d) {
      return makeResult({
        date: d,
        type: INPUT_TYPES.RELATIVE,
        confidence: "high",
        originalInput,
        normalised: raw,
      });
    }
  }

  return null;
}

// ── Offset Helper ─────────────────────────────────────────────────────────────

function _offsetDate(base, n, unit) {
  const d = new Date(base);
  switch (unit) {
    case "second":  d.setSeconds(d.getSeconds() + n); break;
    case "minute":  d.setMinutes(d.getMinutes() + n); break;
    case "hour":    d.setHours(d.getHours() + n); break;
    case "day":     d.setDate(d.getDate() + n); break;
    case "week":    d.setDate(d.getDate() + n * 7); break;
    case "month":   d.setMonth(d.getMonth() + n); break;
    case "year":    d.setFullYear(d.getFullYear() + n); break;
    default: return null;
  }
  return isValidDate(d) ? d : null;
}

function _boundary(base, which, unit) {
  const d = new Date(base);
  if (unit === "day") {
    if (which === "start") { d.setHours(0, 0, 0, 0); }
    else { d.setHours(23, 59, 59, 999); }
  } else if (unit === "week") {
    const dow = d.getDay();
    if (which === "start") {
      d.setDate(d.getDate() - dow);
      d.setHours(0, 0, 0, 0);
    } else {
      d.setDate(d.getDate() + (6 - dow));
      d.setHours(23, 59, 59, 999);
    }
  } else if (unit === "month") {
    if (which === "start") {
      return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    } else {
      return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    }
  } else if (unit === "year") {
    if (which === "start") {
      return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
    } else {
      return new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
    }
  }
  return isValidDate(d) ? d : null;
}

// ── Main Parse Pipeline ───────────────────────────────────────────────────────

/**
 * Parse any input string into a ParseResult.
 * Tries parsers in priority order.
 *
 * @param {string} input
 * @returns {ParseResult}
 */
export function parse(input) {
  if (!input || typeof input !== "string") {
    return errorResult(input || "", "Empty input");
  }

  const trimmed = input.trim();
  if (!trimmed) return errorResult(input, "Empty input");

  // ── Ordered parser chain ──
  const parsers = [
    // 1. Relative / natural language (before numeric, "now" etc.)
    () => parseRelative(trimmed, input),

    // 2. Pure numeric → Unix timestamp
    () => parseUnixTimestamp(trimmed, input),

    // 3. ISO 8601 full datetime
    () => parseISO8601(trimmed, input),

    // 4. ISO week date
    () => parseISOWeek(trimmed, input),

    // 5. ISO ordinal date
    () => parseISOOrdinal(trimmed, input),

    // 6. RFC 2822
    () => parseRFC2822(trimmed, input),

    // 7. SQL datetime (space-separated)
    () => parseSQLDatetime(trimmed, input),

    // 8. EU date (DD.MM.YYYY)
    () => parseEUDate(trimmed, input),

    // 9. US date (MM/DD/YYYY)
    () => parseUSDate(trimmed, input),

    // 10. Partial year-month
    () => parsePartialYearMonth(trimmed, input),

    // 11. Month-name based
    () => parseMonthName(trimmed, input),

    // 12. Last resort: native Date constructor
    () => _nativeFallback(trimmed, input),
  ];

  for (const parser of parsers) {
    try {
      const result = parser();
      if (result && result.date && isValidDate(result.date)) {
        return result;
      }
    } catch (_) {
      // Never throw — continue to next parser
    }
  }

  return errorResult(input, "Unrecognized format");
}

/**
 * Native Date constructor fallback (low confidence).
 */
function _nativeFallback(input, originalInput) {
  const date = new Date(input);
  if (!isValidDate(date)) return null;

  return makeResult({
    date,
    type: INPUT_TYPES.HUMAN_READABLE,
    confidence: "low",
    originalInput,
    normalised: input,
  });
}

/**
 * Detect the type of an input without fully parsing.
 * Returns an INPUT_TYPES key.
 * @param {string} input
 * @returns {string}
 */
export function detectType(input) {
  if (!input || !input.trim()) return INPUT_TYPES.UNKNOWN;
  const r = parse(input);
  return r.error ? INPUT_TYPES.UNKNOWN : r.type;
}

/**
 * Quick check: is this string a valid timestamp/date?
 * @param {string} input
 * @returns {boolean}
 */
export function isValidInput(input) {
  const r = parse(input);
  return !r.error && isValidDate(r.date);
}

/**
 * Parse and return only the Date object (null on failure).
 * @param {string} input
 * @returns {Date|null}
 */
export function parseToDate(input) {
  const r = parse(input);
  return r.error ? null : r.date;
}