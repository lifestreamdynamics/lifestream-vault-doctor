import { describe, it, expect } from 'vitest';
import { formatReport, generateDocPath } from '../formatter.js';
import type { CrashReport } from '../types.js';

function makeReport(overrides: Partial<CrashReport> = {}): CrashReport {
  return {
    id: 'abcdef12-3456-4789-abcd-ef1234567890',
    timestamp: '2024-06-15T10:30:00.000Z',
    errorName: 'TypeError',
    errorMessage: 'Cannot read properties of undefined',
    stackTrace: 'TypeError: Cannot read properties of undefined\n    at foo (app.js:10:5)',
    severity: 'error',
    sessionId: 'sess-0001',
    sessionDurationMs: 5000,
    environment: 'production',
    device: {
      platform: 'iOS',
      osVersion: '17.0',
      appVersion: '1.2.3',
    },
    breadcrumbs: [],
    tags: ['error', 'env:production', 'typeerror'],
    ...overrides,
  };
}

describe('formatReport', () => {
  describe('YAML frontmatter', () => {
    it('opens and closes with ---', () => {
      const output = formatReport(makeReport());
      const lines = output.split('\n');
      expect(lines[0]).toBe('---');
      const closingIdx = lines.indexOf('---', 1);
      expect(closingIdx).toBeGreaterThan(0);
    });

    it('includes the title with severity and error in brackets', () => {
      const output = formatReport(makeReport({ severity: 'fatal', errorName: 'RangeError', errorMessage: 'Index out of bounds' }));
      expect(output).toContain('[FATAL] RangeError: Index out of bounds');
    });

    it('includes the date field matching the report timestamp', () => {
      const output = formatReport(makeReport());
      expect(output).toContain('date: 2024-06-15T10:30:00.000Z');
    });

    it('includes severity field', () => {
      const output = formatReport(makeReport({ severity: 'warning' }));
      expect(output).toContain('severity: warning');
    });

    it('includes sessionId field', () => {
      const output = formatReport(makeReport());
      expect(output).toContain('sessionId: sess-0001');
    });

    it('includes environment field', () => {
      const output = formatReport(makeReport({ environment: 'staging' }));
      expect(output).toContain('environment: staging');
    });

    it('includes device platform field', () => {
      const output = formatReport(makeReport());
      expect(output).toContain('device: iOS');
    });

    it('includes os field', () => {
      const output = formatReport(makeReport());
      expect(output).toContain('os: 17.0');
    });

    it('includes appVersion field', () => {
      const output = formatReport(makeReport());
      expect(output).toContain('appVersion: 1.2.3');
    });

    it('defaults device/os/appVersion to unknown when not provided', () => {
      const output = formatReport(makeReport({ device: {} }));
      expect(output).toContain('device: unknown');
      expect(output).toContain('os: unknown');
      expect(output).toContain('appVersion: unknown');
    });
  });

  describe('tags as YAML array', () => {
    it('renders non-empty tags as a YAML list', () => {
      const report = makeReport({ tags: ['error', 'env:production', 'typeerror'] });
      const output = formatReport(report);
      expect(output).toContain('tags:');
      expect(output).toContain('  - error');
      expect(output).toContain('  - env:production');
      expect(output).toContain('  - typeerror');
    });

    it('renders empty tags as tags: []', () => {
      const output = formatReport(makeReport({ tags: [] }));
      expect(output).toContain('tags: []');
    });
  });

  describe('stack trace', () => {
    it('renders stack trace inside a fenced code block', () => {
      const report = makeReport({ stackTrace: 'Error: boom\n    at bar (index.js:5:1)' });
      const output = formatReport(report);
      expect(output).toContain('## Stack Trace');
      expect(output).toContain('```\nError: boom\n    at bar (index.js:5:1)\n```');
    });

    it('renders empty fenced block when stackTrace is undefined', () => {
      const output = formatReport(makeReport({ stackTrace: undefined }));
      expect(output).toContain('## Stack Trace\n\n```\n```');
    });

    it('truncates stack traces longer than 4000 chars', () => {
      const longStack = 'x'.repeat(5000);
      const output = formatReport(makeReport({ stackTrace: longStack }));
      expect(output).toContain('[truncated]');
      // The preserved part should be exactly 4000 chars
      const truncatedPart = 'x'.repeat(4000);
      expect(output).toContain(truncatedPart);
    });

    it('does not truncate stack traces of exactly 4000 chars', () => {
      const exactStack = 'y'.repeat(4000);
      const output = formatReport(makeReport({ stackTrace: exactStack }));
      expect(output).not.toContain('[truncated]');
    });

    it('does not truncate stack traces shorter than 4000 chars', () => {
      const shortStack = 'z'.repeat(100);
      const output = formatReport(makeReport({ stackTrace: shortStack }));
      expect(output).not.toContain('[truncated]');
    });
  });

  describe('component stack section', () => {
    it('includes component stack section when provided', () => {
      const report = makeReport({ componentStack: '\n    in MyComponent\n    in App' });
      const output = formatReport(report);
      expect(output).toContain('## Component Stack');
      expect(output).toContain('in MyComponent');
    });

    it('omits component stack section when not provided', () => {
      const output = formatReport(makeReport({ componentStack: undefined }));
      expect(output).not.toContain('## Component Stack');
    });
  });

  describe('breadcrumbs table', () => {
    it('includes the breadcrumbs table header', () => {
      const output = formatReport(makeReport());
      expect(output).toContain('## Breadcrumbs');
      expect(output).toContain('| Time | Type | Message |');
      expect(output).toContain('|------|------|---------|');
    });

    it('shows placeholder row when breadcrumbs is empty', () => {
      const output = formatReport(makeReport({ breadcrumbs: [] }));
      expect(output).toContain('| — | — | — |');
    });

    it('renders each breadcrumb as a table row', () => {
      const report = makeReport({
        breadcrumbs: [
          { timestamp: '2024-06-15T10:29:00.000Z', type: 'navigation', message: 'went to /home' },
          { timestamp: '2024-06-15T10:29:30.000Z', type: 'user', message: 'clicked button' },
        ],
      });
      const output = formatReport(report);
      expect(output).toContain('| 2024-06-15T10:29:00.000Z | navigation | went to /home |');
      expect(output).toContain('| 2024-06-15T10:29:30.000Z | user | clicked button |');
    });
  });

  describe('device context section', () => {
    it('includes Device Context heading', () => {
      const output = formatReport(makeReport());
      expect(output).toContain('## Device Context');
    });

    it('renders each device context entry as a list item', () => {
      const output = formatReport(makeReport({
        device: { platform: 'Android', osVersion: '14', appVersion: '2.0.0' },
      }));
      expect(output).toContain('- **platform**: Android');
      expect(output).toContain('- **osVersion**: 14');
      expect(output).toContain('- **appVersion**: 2.0.0');
    });

    it('shows no device context message when device object is empty', () => {
      const output = formatReport(makeReport({ device: {} }));
      expect(output).toContain('_No device context available._');
    });
  });

  describe('additional context section', () => {
    it('includes Additional Context section with JSON block when extra is provided', () => {
      const report = makeReport({ extra: { userId: 'u123', action: 'submit' } });
      const output = formatReport(report);
      expect(output).toContain('## Additional Context');
      expect(output).toContain('```json');
      expect(output).toContain('"userId": "u123"');
      expect(output).toContain('"action": "submit"');
    });

    it('omits Additional Context section when extra is undefined', () => {
      const output = formatReport(makeReport({ extra: undefined }));
      expect(output).not.toContain('## Additional Context');
    });

    it('handles circular references in extra without crashing', () => {
      const circular: Record<string, unknown> = { key: 'value' };
      circular.self = circular;
      const report = makeReport({ extra: circular });
      const output = formatReport(report);
      expect(output).toContain('## Additional Context');
      expect(output).toContain('Failed to serialize extra context');
    });

    it('truncates extra context larger than 50KB', () => {
      const largeExtra = { data: 'x'.repeat(60_000) };
      const report = makeReport({ extra: largeExtra });
      const output = formatReport(report);
      expect(output).toContain('Extra context too large');
    });
  });

  describe('YAML escaping for special characters', () => {
    it('wraps title in double quotes when errorMessage contains a colon followed by space', () => {
      const report = makeReport({ errorMessage: 'fetch: network error' });
      const output = formatReport(report);
      // The whole title field value should be double-quoted
      const titleLine = output.split('\n').find(l => l.startsWith('title: '));
      expect(titleLine).toBeDefined();
      expect(titleLine).toMatch(/^title: "/);
    });

    it('wraps values containing # in double quotes', () => {
      const report = makeReport({ environment: 'feature#123' });
      const output = formatReport(report);
      expect(output).toContain('environment: "feature#123"');
    });

    it('wraps values containing [ in double quotes', () => {
      const report = makeReport({ environment: '[test]' });
      const output = formatReport(report);
      expect(output).toContain('environment: "[test]"');
    });

    it('wraps values containing { in double quotes', () => {
      const report = makeReport({ environment: '{dev}' });
      const output = formatReport(report);
      expect(output).toContain('environment: "{dev}"');
    });

    it('does not quote simple alphanumeric values', () => {
      const report = makeReport({ environment: 'production' });
      const output = formatReport(report);
      expect(output).toContain('environment: production');
    });
  });
});

describe('generateDocPath', () => {
  const report = makeReport({
    id: 'abcdef12-3456-4000-8000-ef1234567890',
    timestamp: '2024-06-15T10:30:00.000Z',
    errorName: 'TypeError',
  });

  it('uses the default prefix of crash-reports', () => {
    const path = generateDocPath(report);
    expect(path).toMatch(/^crash-reports\//);
  });

  it('uses a custom prefix when provided', () => {
    const path = generateDocPath(report, 'errors/mobile');
    expect(path).toMatch(/^errors\/mobile\//);
  });

  it('includes the YYYY-MM-DD date segment', () => {
    const path = generateDocPath(report);
    expect(path).toContain('/2024-06-15/');
  });

  it('lowercases and normalises the errorName', () => {
    const path = generateDocPath(report);
    expect(path).toContain('typeerror-');
  });

  it('replaces non-alphanumeric characters in errorName with hyphens', () => {
    const path = generateDocPath(makeReport({ errorName: 'My Custom Error!', id: 'aabbccdd-0000-4000-8000-112233445566' }));
    expect(path).toContain('my-custom-error--');
  });

  it('appends an 8-character short id derived from the report id', () => {
    // id = abcdef12-3456-4000-8000-ef1234567890 → strip hyphens → abcdef123456400080... → first 8 = abcdef12
    const path = generateDocPath(report);
    expect(path).toContain('-abcdef12.md');
  });

  it('ends with .md', () => {
    const path = generateDocPath(report);
    expect(path).toMatch(/\.md$/);
  });

  it('format is {prefix}/{YYYY-MM-DD}/{errorname}-{8charId}.md', () => {
    const path = generateDocPath(report);
    expect(path).toMatch(/^crash-reports\/\d{4}-\d{2}-\d{2}\/[a-z0-9-]+-[a-f0-9]{8}\.md$/);
  });
});
