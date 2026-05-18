/**
 * timezone.js
 * Timezone intelligence module for Timestamp Converter.
 *
 * Uses exclusively Intl.DateTimeFormat — no external timezone libraries.
 * Fully offline, no network calls.
 *
 * Provides:
 *   - Multi-timezone simultaneous display
 *   - Timezone selector with search
 *   - Local timezone detection
 *   - Offset calculation for any timezone at a specific moment
 *   - DST detection
 *   - Full IANA timezone list (curated, ~100 major zones)
 */

// ── IANA Timezone Database (curated major zones) ──────────────────────────────
// Format: { id, label, region, utcOffset (approximate, for sorting/display) }
// Actual offset is always computed dynamically via Intl to handle DST correctly.

export const TIMEZONE_LIST = [
  // ── UTC ──
  { id: "UTC",                         label: "UTC",                               region: "UTC" },

  // ── Africa ──
  { id: "Africa/Abidjan",              label: "Abidjan (GMT+0)",                   region: "Africa" },
  { id: "Africa/Accra",                label: "Accra (GMT+0)",                     region: "Africa" },
  { id: "Africa/Addis_Ababa",          label: "Addis Ababa (EAT+3)",               region: "Africa" },
  { id: "Africa/Cairo",                label: "Cairo (EET+2)",                     region: "Africa" },
  { id: "Africa/Casablanca",           label: "Casablanca (WET+0/+1)",             region: "Africa" },
  { id: "Africa/Johannesburg",         label: "Johannesburg (SAST+2)",             region: "Africa" },
  { id: "Africa/Lagos",                label: "Lagos (WAT+1)",                     region: "Africa" },
  { id: "Africa/Nairobi",              label: "Nairobi (EAT+3)",                   region: "Africa" },
  { id: "Africa/Tunis",                label: "Tunis (CET+1)",                     region: "Africa" },

  // ── Americas ──
  { id: "America/Anchorage",           label: "Anchorage (AKST-9)",                region: "Americas" },
  { id: "America/Argentina/Buenos_Aires", label: "Buenos Aires (ART-3)",           region: "Americas" },
  { id: "America/Bogota",              label: "Bogotá (COT-5)",                    region: "Americas" },
  { id: "America/Caracas",             label: "Caracas (VET-4)",                   region: "Americas" },
  { id: "America/Chicago",             label: "Chicago (CST-6)",                   region: "Americas" },
  { id: "America/Denver",              label: "Denver (MST-7)",                    region: "Americas" },
  { id: "America/Halifax",             label: "Halifax (AST-4)",                   region: "Americas" },
  { id: "America/Havana",              label: "Havana (CST-5)",                    region: "Americas" },
  { id: "America/Lima",                label: "Lima (PET-5)",                      region: "Americas" },
  { id: "America/Los_Angeles",         label: "Los Angeles (PST-8)",               region: "Americas" },
  { id: "America/Mexico_City",         label: "Mexico City (CST-6)",               region: "Americas" },
  { id: "America/New_York",            label: "New York (EST-5)",                  region: "Americas" },
  { id: "America/Phoenix",             label: "Phoenix (MST-7, no DST)",           region: "Americas" },
  { id: "America/Santiago",            label: "Santiago (CLT-3/-4)",               region: "Americas" },
  { id: "America/Sao_Paulo",           label: "São Paulo (BRT-3)",                 region: "Americas" },
  { id: "America/St_Johns",            label: "St. John's (NST-3:30)",             region: "Americas" },
  { id: "America/Toronto",             label: "Toronto (EST-5)",                   region: "Americas" },
  { id: "America/Vancouver",           label: "Vancouver (PST-8)",                 region: "Americas" },

  // ── Asia ──
  { id: "Asia/Almaty",                 label: "Almaty (ALMT+6)",                   region: "Asia" },
  { id: "Asia/Baghdad",                label: "Baghdad (AST+3)",                   region: "Asia" },
  { id: "Asia/Baku",                   label: "Baku (AZT+4)",                      region: "Asia" },
  { id: "Asia/Bangkok",                label: "Bangkok (ICT+7)",                   region: "Asia" },
  { id: "Asia/Colombo",                label: "Colombo (IST+5:30)",                region: "Asia" },
  { id: "Asia/Dhaka",                  label: "Dhaka (BST+6)",                     region: "Asia" },
  { id: "Asia/Dubai",                  label: "Dubai (GST+4)",                     region: "Asia" },
  { id: "Asia/Ho_Chi_Minh",            label: "Ho Chi Minh City (ICT+7)",          region: "Asia" },
  { id: "Asia/Hong_Kong",              label: "Hong Kong (HKT+8)",                 region: "Asia" },
  { id: "Asia/Jakarta",                label: "Jakarta (WIB+7)",                   region: "Asia" },
  { id: "Asia/Jerusalem",              label: "Jerusalem (IST+2)",                 region: "Asia" },
  { id: "Asia/Karachi",                label: "Karachi (PKT+5)",                   region: "Asia" },
  { id: "Asia/Kathmandu",              label: "Kathmandu (NPT+5:45)",              region: "Asia" },
  { id: "Asia/Kolkata",                label: "Kolkata / Mumbai (IST+5:30)",       region: "Asia" },
  { id: "Asia/Kuala_Lumpur",           label: "Kuala Lumpur (MYT+8)",              region: "Asia" },
  { id: "Asia/Kuwait",                 label: "Kuwait (AST+3)",                    region: "Asia" },
  { id: "Asia/Manila",                 label: "Manila (PHT+8)",                    region: "Asia" },
  { id: "Asia/Nicosia",                label: "Nicosia (EET+2)",                   region: "Asia" },
  { id: "Asia/Riyadh",                 label: "Riyadh (AST+3)",                    region: "Asia" },
  { id: "Asia/Seoul",                  label: "Seoul (KST+9)",                     region: "Asia" },
  { id: "Asia/Shanghai",               label: "Shanghai (CST+8)",                  region: "Asia" },
  { id: "Asia/Singapore",              label: "Singapore (SGT+8)",                 region: "Asia" },
  { id: "Asia/Taipei",                 label: "Taipei (CST+8)",                    region: "Asia" },
  { id: "Asia/Tashkent",               label: "Tashkent (UZT+5)",                  region: "Asia" },
  { id: "Asia/Tbilisi",                label: "Tbilisi (GET+4)",                   region: "Asia" },
  { id: "Asia/Tehran",                 label: "Tehran (IRST+3:30)",                region: "Asia" },
  { id: "Asia/Tokyo",                  label: "Tokyo (JST+9)",                     region: "Asia" },
  { id: "Asia/Ulaanbaatar",            label: "Ulaanbaatar (ULAT+8)",              region: "Asia" },
  { id: "Asia/Yangon",                 label: "Yangon (MMT+6:30)",                 region: "Asia" },
  { id: "Asia/Yerevan",                label: "Yerevan (AMT+4)",                   region: "Asia" },

  // ── Atlantic ──
  { id: "Atlantic/Azores",             label: "Azores (AZOT-1)",                   region: "Atlantic" },
  { id: "Atlantic/Cape_Verde",         label: "Cape Verde (CVT-1)",                region: "Atlantic" },
  { id: "Atlantic/Reykjavik",          label: "Reykjavik (GMT+0)",                 region: "Atlantic" },

  // ── Australia ──
  { id: "Australia/Adelaide",          label: "Adelaide (ACST+9:30)",              region: "Australia" },
  { id: "Australia/Brisbane",          label: "Brisbane (AEST+10, no DST)",        region: "Australia" },
  { id: "Australia/Darwin",            label: "Darwin (ACST+9:30, no DST)",        region: "Australia" },
  { id: "Australia/Hobart",            label: "Hobart (AEDT+11)",                  region: "Australia" },
  { id: "Australia/Lord_Howe",         label: "Lord Howe Island (LHST+10:30)",     region: "Australia" },
  { id: "Australia/Perth",             label: "Perth (AWST+8)",                    region: "Australia" },
  { id: "Australia/Sydney",            label: "Sydney (AEDT+11)",                  region: "Australia" },

  // ── Europe ──
  { id: "Europe/Amsterdam",            label: "Amsterdam (CET+1)",                 region: "Europe" },
  { id: "Europe/Athens",               label: "Athens (EET+2)",                    region: "Europe" },
  { id: "Europe/Belgrade",             label: "Belgrade (CET+1)",                  region: "Europe" },
  { id: "Europe/Berlin",               label: "Berlin (CET+1)",                    region: "Europe" },
  { id: "Europe/Brussels",             label: "Brussels (CET+1)",                  region: "Europe" },
  { id: "Europe/Bucharest",            label: "Bucharest (EET+2)",                 region: "Europe" },
  { id: "Europe/Budapest",             label: "Budapest (CET+1)",                  region: "Europe" },
  { id: "Europe/Copenhagen",           label: "Copenhagen (CET+1)",                region: "Europe" },
  { id: "Europe/Dublin",               label: "Dublin (GMT+0/IST+1)",              region: "Europe" },
  { id: "Europe/Helsinki",             label: "Helsinki (EET+2)",                  region: "Europe" },
  { id: "Europe/Istanbul",             label: "Istanbul (TRT+3)",                  region: "Europe" },
  { id: "Europe/Kaliningrad",          label: "Kaliningrad (EET+2)",               region: "Europe" },
  { id: "Europe/Kiev",                 label: "Kyiv (EET+2)",                      region: "Europe" },
  { id: "Europe/Lisbon",               label: "Lisbon (WET+0)",                    region: "Europe" },
  { id: "Europe/London",               label: "London (GMT+0/BST+1)",              region: "Europe" },
  { id: "Europe/Luxembourg",           label: "Luxembourg (CET+1)",                region: "Europe" },
  { id: "Europe/Madrid",               label: "Madrid (CET+1)",                    region: "Europe" },
  { id: "Europe/Minsk",                label: "Minsk (FET+3)",                     region: "Europe" },
  { id: "Europe/Moscow",               label: "Moscow (MSK+3)",                    region: "Europe" },
  { id: "Europe/Oslo",                 label: "Oslo (CET+1)",                      region: "Europe" },
  { id: "Europe/Paris",                label: "Paris (CET+1)",                     region: "Europe" },
  { id: "Europe/Prague",               label: "Prague (CET+1)",                    region: "Europe" },
  { id: "Europe/Riga",                 label: "Riga (EET+2)",                      region: "Europe" },
  { id: "Europe/Rome",                 label: "Rome (CET+1)",                      region: "Europe" },
  { id: "Europe/Samara",               label: "Samara (SAMT+4)",                   region: "Europe" },
  { id: "Europe/Sofia",                label: "Sofia (EET+2)",                     region: "Europe" },
  { id: "Europe/Stockholm",            label: "Stockholm (CET+1)",                 region: "Europe" },
  { id: "Europe/Tallinn",              label: "Tallinn (EET+2)",                   region: "Europe" },
  { id: "Europe/Vienna",               label: "Vienna (CET+1)",                    region: "Europe" },
  { id: "Europe/Vilnius",              label: "Vilnius (EET+2)",                   region: "Europe" },
  { id: "Europe/Warsaw",               label: "Warsaw (CET+1)",                    region: "Europe" },
  { id: "Europe/Zurich",               label: "Zurich (CET+1)",                    region: "Europe" },

  // ── Indian Ocean ──
  { id: "Indian/Maldives",             label: "Maldives (MVT+5)",                  region: "Indian" },
  { id: "Indian/Mauritius",            label: "Mauritius (MUT+4)",                 region: "Indian" },

  // ── Pacific ──
  { id: "Pacific/Auckland",            label: "Auckland (NZDT+13)",                region: "Pacific" },
  { id: "Pacific/Fiji",                label: "Fiji (FJT+12)",                     region: "Pacific" },
  { id: "Pacific/Guam",                label: "Guam (ChST+10)",                    region: "Pacific" },
  { id: "Pacific/Honolulu",            label: "Honolulu (HST-10, no DST)",         region: "Pacific" },
  { id: "Pacific/Noumea",              label: "Noumea (NCT+11)",                   region: "Pacific" },
  { id: "Pacific/Pago_Pago",           label: "Pago Pago (SST-11)",                region: "Pacific" },
  { id: "Pacific/Port_Moresby",        label: "Port Moresby (PGT+10)",             region: "Pacific" },
  { id: "Pacific/Tongatapu",           label: "Tongatapu (TOT+13)",                region: "Pacific" },
];

// ── Featured timezones shown in the multi-TZ preview panel ───────────────────
export const FEATURED_TIMEZONES = [
  { id: "UTC",                  label: "UTC",          flagEmoji: "🌐" },
  { id: "local",                label: "Local",        flagEmoji: "📍" },
  { id: "America/New_York",     label: "New York",     flagEmoji: "🗽" },
  { id: "America/Los_Angeles",  label: "Los Angeles",  flagEmoji: "🎬" },
  { id: "Europe/London",        label: "London",       flagEmoji: "🎡" },
  { id: "Europe/Berlin",        label: "Berlin",       flagEmoji: "🏛️" },
  { id: "Europe/Istanbul",      label: "Istanbul",     flagEmoji: "🕌" },
  { id: "Asia/Dubai",           label: "Dubai",        flagEmoji: "🏙️" },
  { id: "Asia/Kolkata",         label: "Mumbai/Delhi", flagEmoji: "🇮🇳" },
  { id: "Asia/Shanghai",        label: "Shanghai",     flagEmoji: "🏮" },
  { id: "Asia/Tokyo",           label: "Tokyo",        flagEmoji: "⛩️" },
  { id: "Australia/Sydney",     label: "Sydney",       flagEmoji: "🦘" },
];

// ── Formatter Cache ────────────────────────────────────────────────────────────
const _tzFmtCache = new Map();

function _getTZFormatter(timeZone, locale, options = {}) {
  const key = `${timeZone}|${locale}|${JSON.stringify(options)}`;
  if (!_tzFmtCache.has(key)) {
    _tzFmtCache.set(
      key,
      new Intl.DateTimeFormat(locale || undefined, { timeZone, ...options })
    );
  }
  return _tzFmtCache.get(key);
}

// ── Core Functions ────────────────────────────────────────────────────────────

/**
 * Detect the user's local IANA timezone identifier.
 * @returns {string}
 */
export function getLocalTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (_) {
    return "UTC";
  }
}

/**
 * Format a Date in a specific IANA timezone.
 * @param {Date} date
 * @param {string} timeZone - IANA timezone ID (e.g. "America/New_York")
 * @param {string} [locale]
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatInTimezone(date, timeZone, locale, options = {}) {
  if (!date || isNaN(date.getTime())) return "Invalid Date";

  const tz = timeZone === "local" ? getLocalTimezone() : timeZone;

  const defaultOpts = {
    year:   "numeric",
    month:  "2-digit",
    day:    "2-digit",
    hour:   "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...options,
  };

  try {
    return _getTZFormatter(tz, locale || undefined, defaultOpts).format(date);
  } catch (_) {
    // Invalid timezone ID gracefully degraded
    return "Unsupported timezone";
  }
}

/**
 * Get the UTC offset (in minutes) for a timezone at a specific Date.
 * Uses a trick: format the date in the target TZ and compare to UTC parts.
 * @param {Date} date
 * @param {string} timeZone
 * @returns {number} - offset in minutes (e.g. +330 for IST, -300 for EST)
 */
export function getTimezoneOffsetMinutes(date, timeZone) {
  if (timeZone === "UTC") return 0;
  const tz = timeZone === "local" ? getLocalTimezone() : timeZone;

  try {
    // Get date parts in the target timezone
    const fmt = new Intl.DateTimeFormat("en", {
      timeZone: tz,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
      hour12: false,
    });

    const parts = fmt.formatToParts(date).reduce((acc, { type, value }) => {
      acc[type] = parseInt(value, 10);
      return acc;
    }, {});

    // Reconstruct date in target TZ and compare to UTC
    const tzDate = new Date(
      Date.UTC(
        parts.year, parts.month - 1, parts.day,
        parts.hour === 24 ? 0 : parts.hour,
        parts.minute, parts.second
      )
    );

    return Math.round((tzDate.getTime() - date.getTime()) / 60000);
  } catch (_) {
    return 0;
  }
}

/**
 * Format the UTC offset as a string (e.g. "+05:30", "-08:00", "UTC").
 * @param {number} offsetMinutes
 * @returns {string}
 */
export function formatOffsetString(offsetMinutes) {
  if (offsetMinutes === 0) return "+00:00";
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const h = String(Math.floor(abs / 60)).padStart(2, "0");
  const m = String(abs % 60).padStart(2, "0");
  return `${sign}${h}:${m}`;
}

/**
 * Check if a timezone currently observes DST (i.e. is offset different
 * in January vs July for the same year).
 * @param {string} timeZone
 * @returns {boolean}
 */
export function observesDST(timeZone) {
  try {
    const tz = timeZone === "local" ? getLocalTimezone() : timeZone;
    const year = new Date().getFullYear();
    const jan  = new Date(year, 0, 15); // mid-January
    const jul  = new Date(year, 6, 15); // mid-July
    const janOffset = getTimezoneOffsetMinutes(jan, tz);
    const julOffset = getTimezoneOffsetMinutes(jul, tz);
    return janOffset !== julOffset;
  } catch (_) {
    return false;
  }
}

/**
 * Check if a given Date is currently in DST for a timezone.
 * @param {Date} date
 * @param {string} timeZone
 * @returns {boolean}
 */
export function isInDST(date, timeZone) {
  try {
    const tz = timeZone === "local" ? getLocalTimezone() : timeZone;
    const year = date.getFullYear();
    const jan = new Date(year, 0, 15);
    const jul = new Date(year, 6, 15);
    const janOffset = getTimezoneOffsetMinutes(jan, tz);
    const julOffset = getTimezoneOffsetMinutes(jul, tz);
    const currentOffset = getTimezoneOffsetMinutes(date, tz);

    // DST is the offset that differs from the standard (winter) offset
    const stdOffset = Math.min(janOffset, julOffset);
    return currentOffset !== stdOffset;
  } catch (_) {
    return false;
  }
}

/**
 * Get full timezone info for a given Date and timezone ID.
 * @param {Date} date
 * @param {string} timeZone
 * @param {string} [locale]
 * @returns {TimezoneInfo}
 */
export function getTimezoneInfo(date, timeZone, locale) {
  const tz = timeZone === "local" ? getLocalTimezone() : timeZone;
  const offsetMinutes = getTimezoneOffsetMinutes(date, tz);
  const offsetStr = formatOffsetString(offsetMinutes);
  const isDST = isInDST(date, tz);
  const hasDST = observesDST(tz);

  // Get short timezone abbreviation (e.g. "EST", "GMT+3")
  let abbr = "";
  try {
    const shortFmt = new Intl.DateTimeFormat(locale || "en", {
      timeZone: tz,
      timeZoneName: "short",
    });
    const parts = shortFmt.formatToParts(date);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    abbr = tzPart ? tzPart.value : "";
  } catch (_) {}

  // Get long timezone name (e.g. "Eastern Standard Time")
  let longName = "";
  try {
    const longFmt = new Intl.DateTimeFormat(locale || "en", {
      timeZone: tz,
      timeZoneName: "long",
    });
    const parts = longFmt.formatToParts(date);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    longName = tzPart ? tzPart.value : "";
  } catch (_) {}

  return {
    id: tz,
    displayId: timeZone,
    offsetMinutes,
    offsetString: offsetStr,
    abbreviation: abbr,
    longName,
    isDST,
    hasDST,
    formatted: formatInTimezone(date, tz, locale),
  };
}

/**
 * Generate multi-timezone preview rows for the featured timezones.
 * @param {Date} date
 * @param {string} [locale]
 * @returns {Array<TimezonePreviewRow>}
 */
export function getMultiTimezonePreview(date, locale) {
  return FEATURED_TIMEZONES.map((tz) => {
    const info = getTimezoneInfo(date, tz.id, locale);
    return {
      ...tz,
      ...info,
      label: tz.label,
      flagEmoji: tz.flagEmoji,
    };
  });
}

/**
 * Convert a Date to a specific timezone and return a new Date object
 * that represents the same moment in time (UTC ms unchanged),
 * but whose local methods reflect the target timezone's wall-clock time.
 *
 * Note: JavaScript Date objects are always UTC-based. This function
 * returns an adjusted Date useful for display calculations only.
 * @param {Date} date
 * @param {string} timeZone
 * @returns {Date}
 */
export function toTimezone(date, timeZone) {
  const tz = timeZone === "local" ? getLocalTimezone() : timeZone;
  const offsetMinutes = getTimezoneOffsetMinutes(date, tz);
  // Shift the UTC time by the offset so local methods return TZ-correct values
  return new Date(date.getTime() + offsetMinutes * 60000);
}

/**
 * Search the timezone list by query string (label or ID).
 * @param {string} query
 * @returns {Array}
 */
export function searchTimezones(query) {
  if (!query || !query.trim()) return TIMEZONE_LIST;
  const q = query.trim().toLowerCase();
  return TIMEZONE_LIST.filter(
    (tz) =>
      tz.id.toLowerCase().includes(q) ||
      tz.label.toLowerCase().includes(q) ||
      tz.region.toLowerCase().includes(q)
  );
}

/**
 * Get timezones grouped by region.
 * @returns {Object<string, Array>}
 */
export function getTimezonesByRegion() {
  return TIMEZONE_LIST.reduce((acc, tz) => {
    if (!acc[tz.region]) acc[tz.region] = [];
    acc[tz.region].push(tz);
    return acc;
  }, {});
}

/**
 * Validate that a timezone ID is supported by the browser.
 * @param {string} id
 * @returns {boolean}
 */
export function isValidTimezone(id) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: id });
    return true;
  } catch (_) {
    return false;
  }
}