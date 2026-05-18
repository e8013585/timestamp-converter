/**
 * batchConverter.js
 * Batch timestamp/date conversion engine for Timestamp Converter.
 *
 * Handles:
 *   - Multi-line input parsing
 *   - Mixed format detection per line
 *   - Parallel conversion of all standard formats
 *   - Error handling per line (never throws globally)
 *   - JSON export
 *   - TSV/CSV export
 *   - Summary statistics
 *   - Deduplication
 *   - Progress callbacks for large batches
 *
 * Processing is done synchronously in chunks to avoid blocking
 * the main thread for very large inputs (1000+ lines).
 */

import { parse }         from "./parser.js";
import { getAllFormats } from "./formatter.js";
import { toRelativeTime } from "./relativeTime.js";
import { isValidDate }   from "./utils.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum lines to process in a single synchronous chunk */
const CHUNK_SIZE = 50;

/** Maximum total lines allowed */
const MAX_LINES = 2000;

// ── Types (JSDoc) ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} BatchLineResult
 * @property {number}  lineNumber    - 1-based line index
 * @property {string}  originalInput - raw input string
 * @property {boolean} success       - true if parsed successfully
 * @property {string|null} error     - error message if failed
 * @property {string}  detectedType  - INPUT_TYPES key
 * @property {string}  confidence    - "high"|"medium"|"low"
 * @property {Date|null} date        - parsed Date object
 * @property {Object|null} formats   - getAllFormats() output
 * @property {string}  relative      - relative time string
 */

/**
 * @typedef {Object} BatchResult
 * @property {BatchLineResult[]} lines
 * @property {BatchSummary}      summary
 * @property {number}            processedAt  - timestamp ms
 */

/**
 * @typedef {Object} BatchSummary
 * @property {number} total
 * @property {number} successful
 * @property {number} failed
 * @property {number} skipped      - blank lines
 * @property {number} duplicates
 * @property {string[]} errorLines
 */

// ── Line Normaliser ───────────────────────────────────────────────────────────

/**
 * Split raw text input into individual lines, cleaning whitespace.
 * Handles Windows (\r\n), Unix (\n), and old Mac (\r) line endings.
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitLines(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
}

/**
 * Determine if a line should be skipped (blank, comment, header).
 * @param {string} line
 * @returns {boolean}
 */
function isSkippable(line) {
  const trimmed = line.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||   // comment
    trimmed.startsWith("//") ||  // JS comment
    trimmed.startsWith("--")     // SQL comment
  );
}

// ── Single Line Processor ─────────────────────────────────────────────────────

/**
 * Process a single input line into a BatchLineResult.
 * Never throws.
 *
 * @param {string} line
 * @param {number} lineNumber
 * @param {string} [locale]
 * @returns {BatchLineResult}
 */
function processLine(line, lineNumber, locale) {
  const trimmed = line.trim();

  // Base result skeleton
  const base = {
    lineNumber,
    originalInput: line,
    success: false,
    error: null,
    detectedType: "detectedUnknown",
    confidence: "low",
    date: null,
    formats: null,
    relative: "",
  };

  try {
    const parsed = parse(trimmed);

    if (parsed.error) {
      return {
        ...base,
        error: parsed.error,
      };
    }

    if (!parsed.date || !isValidDate(parsed.date)) {
      return {
        ...base,
        error: "Invalid date result",
      };
    }

    const formats  = getAllFormats(parsed.date, locale);
    const relative = toRelativeTime(parsed.date, locale);

    return {
      ...base,
      success:      true,
      detectedType: parsed.type,
      confidence:   parsed.confidence,
      date:         parsed.date,
      formats,
      relative,
    };
  } catch (err) {
    return {
      ...base,
      error: err.message || "Unexpected error",
    };
  }
}

// ── Main Batch Processor ──────────────────────────────────────────────────────

/**
 * Process a multi-line text input synchronously.
 * For inputs over CHUNK_SIZE, uses setTimeout-based chunking
 * and calls progressCallback periodically.
 *
 * @param {string}   text             - Raw multi-line input
 * @param {Object}   [options]
 * @param {string}   [options.locale] - BCP 47 locale for formatting
 * @param {boolean}  [options.deduplicate=false] - Remove duplicate inputs
 * @param {boolean}  [options.skipBlanks=true]   - Skip blank/comment lines
 * @param {Function} [options.onProgress]        - (processed, total) => void
 * @param {Function} [options.onComplete]        - (BatchResult) => void
 * @returns {BatchResult|null}  - Returns synchronously if small, null if chunked
 */
export function processBatch(text, options = {}) {
  const {
    locale        = undefined,
    deduplicate   = false,
    skipBlanks    = true,
    onProgress    = null,
    onComplete    = null,
  } = options;

  if (!text || typeof text !== "string") {
    const empty = _makeEmptyResult();
    if (onComplete) onComplete(empty);
    return empty;
  }

  // Split and optionally filter lines
  let rawLines = splitLines(text);

  // Enforce max lines
  const truncated = rawLines.length > MAX_LINES;
  if (truncated) {
    rawLines = rawLines.slice(0, MAX_LINES);
  }

  // Separate skippable lines
  const lineEntries = rawLines.map((line, i) => ({
    line,
    lineNumber: i + 1,
    skip: skipBlanks && isSkippable(line),
  }));

  // Deduplicate (case-insensitive trim)
  let seen = new Set();
  let duplicateCount = 0;

  const processableEntries = lineEntries.filter(({ line, skip }) => {
    if (skip) return false;
    if (deduplicate) {
      const key = line.trim().toLowerCase();
      if (seen.has(key)) {
        duplicateCount++;
        return false;
      }
      seen.add(key);
    }
    return true;
  });

  const skippedCount = lineEntries.filter((e) => e.skip).length;
  const total = processableEntries.length;

  // Small batch: process synchronously and return immediately
  if (total <= CHUNK_SIZE && !onProgress) {
    const lines = processableEntries.map(({ line, lineNumber }) =>
      processLine(line, lineNumber, locale)
    );
    const result = _buildResult(lines, skippedCount, duplicateCount, truncated);
    if (onComplete) onComplete(result);
    return result;
  }

  // Large batch: process in chunks via setTimeout
  _processChunked(
    processableEntries,
    locale,
    skippedCount,
    duplicateCount,
    truncated,
    total,
    onProgress,
    onComplete
  );

  return null; // Result delivered via onComplete
}

// ── Chunked Processor ─────────────────────────────────────────────────────────

function _processChunked(
  entries,
  locale,
  skippedCount,
  duplicateCount,
  truncated,
  total,
  onProgress,
  onComplete
) {
  const results = [];
  let idx = 0;

  function processNextChunk() {
    const end = Math.min(idx + CHUNK_SIZE, entries.length);

    for (let i = idx; i < end; i++) {
      const { line, lineNumber } = entries[i];
      results.push(processLine(line, lineNumber, locale));
    }

    idx = end;

    if (onProgress) {
      onProgress(idx, total);
    }

    if (idx < entries.length) {
      // Yield to the event loop before next chunk
      setTimeout(processNextChunk, 0);
    } else {
      // All done
      const result = _buildResult(results, skippedCount, duplicateCount, truncated);
      if (onComplete) onComplete(result);
    }
  }

  processNextChunk();
}

// ── Result Builder ────────────────────────────────────────────────────────────

function _buildResult(lines, skippedCount, duplicateCount, truncated) {
  const successful  = lines.filter((l) => l.success).length;
  const failed      = lines.filter((l) => !l.success).length;
  const errorLines  = lines
    .filter((l) => !l.success)
    .map((l) => `Line ${l.lineNumber}: ${l.error || "Unknown error"}`);

  return {
    lines,
    truncated: truncated || false,
    processedAt: Date.now(),
    summary: {
      total:       lines.length,
      successful,
      failed,
      skipped:     skippedCount,
      duplicates:  duplicateCount,
      errorLines,
    },
  };
}

function _makeEmptyResult() {
  return _buildResult([], 0, 0, false);
}

// ── Export Formatters ─────────────────────────────────────────────────────────

/**
 * Export batch results as a JSON string.
 * @param {BatchResult} batchResult
 * @param {boolean} [prettyPrint=true]
 * @returns {string}
 */
export function exportJSON(batchResult, prettyPrint = true) {
  const output = {
    exportedAt: new Date().toISOString(),
    summary:    batchResult.summary,
    results:    batchResult.lines.map((line) => ({
      line:          line.lineNumber,
      input:         line.originalInput.trim(),
      success:       line.success,
      error:         line.error,
      detectedType:  line.detectedType,
      confidence:    line.confidence,
      ...(line.success && line.formats
        ? {
            unixSeconds:      line.formats.unixSeconds,
            unixMilliseconds: line.formats.unixMilliseconds,
            iso8601:          line.formats.iso8601,
            utc:              line.formats.utcString,
            local:            line.formats.localString,
            relative:         line.relative,
          }
        : {}),
    })),
  };

  return prettyPrint
    ? JSON.stringify(output, null, 2)
    : JSON.stringify(output);
}

/**
 * Export batch results as CSV.
 * @param {BatchResult} batchResult
 * @returns {string}
 */
export function exportCSV(batchResult) {
  const headers = [
    "Line",
    "Input",
    "Success",
    "Error",
    "Detected Type",
    "Unix Seconds",
    "Unix Milliseconds",
    "ISO 8601",
    "UTC",
    "Local",
    "Relative",
  ];

  const rows = batchResult.lines.map((line) => [
    line.lineNumber,
    _csvEscape(line.originalInput.trim()),
    line.success ? "true" : "false",
    _csvEscape(line.error || ""),
    line.detectedType,
    line.formats?.unixSeconds   ?? "",
    line.formats?.unixMilliseconds ?? "",
    _csvEscape(line.formats?.iso8601      || ""),
    _csvEscape(line.formats?.utcString    || ""),
    _csvEscape(line.formats?.localString  || ""),
    _csvEscape(line.relative || ""),
  ]);

  const csvLines = [headers.join(","), ...rows.map((r) => r.join(","))];
  return csvLines.join("\n");
}

/**
 * Export batch results as plain text (one result per input line).
 * @param {BatchResult} batchResult
 * @param {string} [format="iso8601"] - which format field to output
 * @returns {string}
 */
export function exportPlainText(batchResult, format = "iso8601") {
  return batchResult.lines
    .map((line) => {
      if (!line.success) return `[ERROR] ${line.originalInput.trim()}: ${line.error}`;
      const value = line.formats?.[format] ?? line.formats?.iso8601 ?? "";
      return `${line.originalInput.trim()} → ${value}`;
    })
    .join("\n");
}

function _csvEscape(str) {
  if (!str) return '""';
  const s = String(str).replace(/"/g, '""');
  return `"${s}"`;
}

// ── Batch Statistics ──────────────────────────────────────────────────────────

/**
 * Generate statistical summary of a batch result.
 * Useful for displaying aggregate info in the UI.
 *
 * @param {BatchResult} batchResult
 * @returns {BatchStats}
 */
export function getBatchStats(batchResult) {
  const successful = batchResult.lines.filter((l) => l.success);
  if (successful.length === 0) {
    return {
      count: 0,
      earliest: null,
      latest: null,
      range: null,
      typeBreakdown: {},
      confidenceBreakdown: {},
    };
  }

  const dates = successful
    .map((l) => l.date)
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  const earliest = dates[0];
  const latest   = dates[dates.length - 1];
  const rangeMs  = latest.getTime() - earliest.getTime();

  // Type breakdown
  const typeBreakdown = {};
  const confidenceBreakdown = {};

  for (const line of successful) {
    typeBreakdown[line.detectedType] =
      (typeBreakdown[line.detectedType] || 0) + 1;
    confidenceBreakdown[line.confidence] =
      (confidenceBreakdown[line.confidence] || 0) + 1;
  }

  return {
    count:               successful.length,
    earliest,
    latest,
    rangeMs,
    rangeDays:           Math.floor(rangeMs / (1000 * 60 * 60 * 24)),
    typeBreakdown,
    confidenceBreakdown,
  };
}

// ── Line Formatter (for UI rendering) ────────────────────────────────────────

/**
 * Format a single BatchLineResult into a display-friendly object.
 * @param {BatchLineResult} lineResult
 * @param {string} [primaryFormat="iso8601"] - which format to show as primary
 * @returns {Object}
 */
export function formatLineForDisplay(lineResult, primaryFormat = "iso8601") {
  if (!lineResult.success) {
    return {
      lineNumber:   lineResult.lineNumber,
      input:        lineResult.originalInput.trim(),
      success:      false,
      error:        lineResult.error,
      primary:      null,
      secondary:    null,
      relative:     null,
      detectedType: lineResult.detectedType,
      confidence:   lineResult.confidence,
    };
  }

  const f = lineResult.formats || {};
  const primary = f[primaryFormat] ?? f.iso8601 ?? "";

  // Secondary: show unix seconds alongside non-unix primary formats
  const secondary =
    primaryFormat !== "unixSeconds"
      ? String(f.unixSeconds ?? "")
      : f.iso8601 ?? "";

  return {
    lineNumber:   lineResult.lineNumber,
    input:        lineResult.originalInput.trim(),
    success:      true,
    error:        null,
    primary,
    secondary,
    relative:     lineResult.relative,
    detectedType: lineResult.detectedType,
    confidence:   lineResult.confidence,
  };
}