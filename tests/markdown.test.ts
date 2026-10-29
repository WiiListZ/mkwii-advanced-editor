import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// api.js reads the page address when it loads.
(globalThis as any).location ??= { search: '' };
const { Markdown, markdownSummary } = await import('../web/src/app/markdown.tsx');
const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

test('release notes render headings, nested lists and inline formatting', () => {
  const out = html([
    '## Objects',
    '',
    '- **Add › Object** from a track',
    '  - **Take from a track:** pick `Race/Common.szs`',
    '  continues on the next line',
    '- Texture animations move the right way (#1).',
    '',
    '1. First',
    '2. Second',
    '',
    '**Full Changelog**: https://github.com/WiiListZ/mkwii-advanced-editor/compare/v1.0.1...v1.0.2',
  ].join('\n'));
  expect(out).toContain('<h2');
  expect(out).toContain('>Objects</h2>');
  expect(out.match(/<ul/g)?.length).toBe(2);
  expect(out).toContain('<strong class="font-semibold text-foreground">Take from a track:</strong>');
  expect(out).toContain('<code');
  expect(out).toContain('Race/Common.szs</code>');
  expect(out).toContain('continues on the next line');
  expect(out).toContain('href="https://github.com/WiiListZ/mkwii-advanced-editor/issues/1"');
  expect(out).toContain('<ol start="1"');
  expect(out).toContain('href="https://github.com/WiiListZ/mkwii-advanced-editor/compare/v1.0.1...v1.0.2"');
});

test('markup in release notes stays text', () => {
  const out = html('<img src=x onerror="alert(1)"> [link](javascript:alert(1)) snake_case_name');
  expect(out).not.toContain('<img');
  expect(out).toContain('&lt;img');
  expect(out).not.toContain('javascript:');
  expect(out).toContain('snake_case_name');
  expect(out).not.toContain('<em>');
});

test('code blocks, quotes, rules and tables', () => {
  const out = html('```\nconst a = 1;\n```\n\n> quoted **text**\n\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |');
  expect(out).toContain('<pre');
  expect(out).toContain('const a = 1;');
  expect(out).toContain('<blockquote');
  expect(out).toContain('<hr');
  expect(out).toContain('<table');
  expect(out).toContain('>2</td>');
});

test('summary is plain text', () => {
  expect(markdownSummary('## New\n\n- **Bold** and `code`\n- [Link](https://github.com)')).toBe('New · Bold and code · Link');
});
