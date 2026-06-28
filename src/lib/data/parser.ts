/**
 * Safe CSV parser with per-row provenance tracking and structured issue logging.
 *
 * Guarantees:
 *  - Never silently drops a row. Every row either parses cleanly or produces a
 *    ParseIssue. The row is still included in the output.
 *  - Every parsed row gets a RowRef pointing back to (file, 1-based rowIndex, pk).
 *  - Header mismatches are reported as errors before any rows are processed.
 *  - Numeric fields that can't parse produce a warn-level issue; the raw string is
 *    preserved in the typed output so downstream code can decide what to do.
 *  - Enum mismatches produce a warn-level issue; the value is preserved.
 */

import fs from "fs";
import path from "path";
import Papa from "papaparse";
import { SCHEMAS } from "./schema";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface RowRef {
  file: string;        // e.g. "allocations.csv"
  rowIndex: number;    // 1-based line number in the source file (header = 0)
  pk: string;          // the value of the PK column for this row
}

export interface ParseIssue {
  file: string;
  rowIndex: number;    // 1-based; 0 = header-level issue
  field: string;
  value: string;
  message: string;
  severity: "warn" | "error";
}

export interface ParseResult<T> {
  rows: T[];
  issues: ParseIssue[];
  /** pk value → RowRef for every row that had a resolvable PK */
  rowRefs: Map<string, RowRef>;
  /** pk value → raw CSV row (all values as strings) */
  rawRows: Map<string, Record<string, string>>;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function readFile(filename: string): string {
  const filePath = path.join(process.cwd(), "data", filename);
  return fs.readFileSync(filePath, "utf-8");
}

function issue(
  file: string,
  rowIndex: number,
  field: string,
  value: string,
  message: string,
  severity: "warn" | "error" = "warn"
): ParseIssue {
  return { file, rowIndex, field, value, message, severity };
}

// ─── Core parser ──────────────────────────────────────────────────────────────

/**
 * Parse a single CSV file against the schema registered under `tableKey`.
 * Returns all rows (even problematic ones) plus a list of issues found.
 */
export function parseCsv<T>(
  tableKey: string
): ParseResult<T> {
  const schema = SCHEMAS[tableKey];
  if (!schema) {
    throw new Error(`parseCsv: no schema for tableKey "${tableKey}"`);
  }

  const { file, pkField, columns } = schema;
  const issues: ParseIssue[] = [];
  const rowRefs = new Map<string, RowRef>();
  const rawRows = new Map<string, Record<string, string>>();

  // ── Read + parse ─────────────────────────────────────────────────────────
  const content = readFile(file);
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  // Papa parse errors (structural issues like unclosed quotes)
  for (const err of parsed.errors) {
    issues.push(
      issue(file, err.row ?? 0, "", "", `Papa parse error: ${err.message}`, "error")
    );
  }

  // ── Header validation ──────────────────────────────────────────────────────
  const actualHeaders = new Set(parsed.meta.fields ?? []);
  const expectedHeaders = Object.keys(columns);

  for (const col of expectedHeaders) {
    if (!actualHeaders.has(col)) {
      issues.push(
        issue(file, 0, col, "", `Expected column "${col}" not found in CSV headers`, "error")
      );
    }
  }
  for (const col of actualHeaders) {
    if (!columns[col]) {
      issues.push(
        issue(file, 0, col, "", `Unexpected column "${col}" not in schema (will be passed through)`, "warn")
      );
    }
  }

  // ── Row-level validation ───────────────────────────────────────────────────
  const rows: T[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const raw = parsed.data[i];
    const rowIndex = i + 1; // 1-based

    // Required fields
    for (const [col, def] of Object.entries(columns)) {
      if (!actualHeaders.has(col)) continue; // already reported above
      const val = raw[col] ?? "";

      if (def.required && !def.allowBlank && val.trim() === "") {
        issues.push(
          issue(file, rowIndex, col, val, `Required field "${col}" is blank`, "error")
        );
      }

      // Numeric validation
      if (def.numeric && val.trim() !== "") {
        const n = parseFloat(val);
        if (!isFinite(n)) {
          issues.push(
            issue(
              file, rowIndex, col, val,
              `Field "${col}" should be numeric but got "${val}"`,
              "warn"
            )
          );
        }
      }

      // Enum validation
      if (def.enumValues && val.trim() !== "") {
        if (!(def.enumValues as readonly string[]).includes(val.trim())) {
          issues.push(
            issue(
              file, rowIndex, col, val,
              `Field "${col}" value "${val}" not in allowed set [${def.enumValues.join(", ")}]`,
              "warn"
            )
          );
        }
      }
    }

    // Provenance
    const pk = raw[pkField]?.trim() ?? "";
    if (pk) {
      const ref: RowRef = { file, rowIndex, pk };
      rowRefs.set(pk, ref);
      rawRows.set(pk, { ...raw });
    } else {
      issues.push(
        issue(file, rowIndex, pkField, "", `Row ${rowIndex} has blank PK field "${pkField}"`, "error")
      );
    }

    rows.push(raw as T);
  }

  return { rows, issues, rowRefs, rawRows };
}

// ─── Batch loader ─────────────────────────────────────────────────────────────

/**
 * Load and validate all CSVs.
 * Returns the merged issues list alongside each table's ParseResult.
 */
export function parseAllCsvs(): {
  results: Record<string, ParseResult<unknown>>;
  allIssues: ParseIssue[];
} {
  const tableKeys = Object.keys(SCHEMAS);
  const results: Record<string, ParseResult<unknown>> = {};
  const allIssues: ParseIssue[] = [];

  for (const key of tableKeys) {
    const result = parseCsv<unknown>(key);
    results[key] = result;
    allIssues.push(...result.issues);

    if (result.issues.length > 0) {
      const errors = result.issues.filter((i) => i.severity === "error").length;
      const warns = result.issues.filter((i) => i.severity === "warn").length;
      console.warn(
        `[parser] ${SCHEMAS[key].file}: ${result.rows.length} rows | ${errors} errors, ${warns} warnings`
      );
    } else {
      console.log(
        `[parser] ${SCHEMAS[key].file}: ${result.rows.length} rows — OK`
      );
    }
  }

  return { results, allIssues };
}
