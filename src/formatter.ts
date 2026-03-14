import type { CrashReport } from './types.js';

/**
 * Strips ASCII control characters (0x00-0x1f except \n, plus 0x7f) to prevent
 * YAML injection via crafted error messages.
 */
function sanitize(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');
}

/**
 * Escapes a YAML scalar value by quoting it if it contains special characters.
 */
function yamlValue(value: string): string {
  const clean = sanitize(value);
  // Quote if contains colon followed by space, starts with special char, or contains newline
  if (
    clean.includes(': ') ||
    clean.includes('#') ||
    clean.includes('"') ||
    clean.includes("'") ||
    clean.includes('\n') ||
    clean.includes('[') ||
    clean.includes(']') ||
    clean.includes('{') ||
    clean.includes('}') ||
    clean.startsWith(' ') ||
    clean.endsWith(' ')
  ) {
    // Use double-quoted style, escape backslashes and double quotes
    return `"${clean.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  return clean;
}

/**
 * Formats a CrashReport as a Markdown document with YAML frontmatter.
 */
export function formatReport(report: CrashReport): string {
  const lines: string[] = [];

  // --- YAML frontmatter ---
  lines.push('---');
  lines.push(`title: ${yamlValue(`[${report.severity.toUpperCase()}] ${report.errorName}: ${report.errorMessage}`)}`);

  // Tags as YAML array
  const allTags = [...report.tags];
  if (allTags.length === 0) {
    lines.push('tags: []');
  } else {
    lines.push('tags:');
    for (const tag of allTags) {
      lines.push(`  - ${yamlValue(tag)}`);
    }
  }

  lines.push(`date: ${report.timestamp}`);
  lines.push(`severity: ${report.severity}`);
  lines.push(`device: ${yamlValue(report.device.platform ?? 'unknown')}`);
  lines.push(`os: ${yamlValue(report.device.osVersion ?? 'unknown')}`);
  lines.push(`appVersion: ${yamlValue(report.device.appVersion ?? 'unknown')}`);
  lines.push(`sessionId: ${report.sessionId}`);
  lines.push(`environment: ${yamlValue(report.environment)}`);
  lines.push('---');
  lines.push('');

  // --- Stack Trace section ---
  lines.push('## Stack Trace');
  lines.push('');
  lines.push('```');
  if (report.stackTrace) {
    const MAX_STACK = 4000;
    if (report.stackTrace.length > MAX_STACK) {
      lines.push(report.stackTrace.slice(0, MAX_STACK));
      lines.push('[truncated]');
    } else {
      lines.push(report.stackTrace);
    }
  }
  lines.push('```');
  lines.push('');

  // --- Component Stack section (only if present) ---
  if (report.componentStack) {
    lines.push('## Component Stack');
    lines.push('');
    lines.push('```');
    lines.push(report.componentStack);
    lines.push('```');
    lines.push('');
  }

  // --- Breadcrumbs section ---
  lines.push('## Breadcrumbs');
  lines.push('');
  lines.push('| Time | Type | Message |');
  lines.push('|------|------|---------|');
  if (report.breadcrumbs.length === 0) {
    lines.push('| — | — | — |');
  } else {
    for (const crumb of report.breadcrumbs) {
      const time = crumb.timestamp.replace(/\|/g, '\\|');
      const type = crumb.type.replace(/\|/g, '\\|');
      const message = crumb.message.replace(/\|/g, '\\|');
      lines.push(`| ${time} | ${type} | ${message} |`);
    }
  }
  lines.push('');

  // --- Device Context section ---
  lines.push('## Device Context');
  lines.push('');
  const deviceEntries = Object.entries(report.device);
  if (deviceEntries.length === 0) {
    lines.push('_No device context available._');
  } else {
    for (const [key, value] of deviceEntries) {
      const displayValue = value === undefined || value === null ? '_unknown_' : String(value);
      lines.push(`- **${key}**: ${displayValue}`);
    }
  }
  lines.push('');

  // --- Additional Context section (only if extra exists) ---
  if (report.extra !== undefined) {
    lines.push('## Additional Context');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(report.extra, null, 2));
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generates a document path for the crash report.
 * Format: {prefix}/{YYYY-MM-DD}/{errorname-lowercase}-{first8chars-of-id}.md
 */
export function generateDocPath(report: CrashReport, prefix: string = 'crash-reports'): string {
  const date = report.timestamp.slice(0, 10); // YYYY-MM-DD
  const errorName = report.errorName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const shortId = report.id.replace(/-/g, '').slice(0, 8);
  return `${prefix}/${date}/${errorName}-${shortId}.md`;
}
