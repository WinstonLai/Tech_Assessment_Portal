// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderAnswerHtml } from './answerHtml';

const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });

describe('renderAnswerHtml', () => {
  it('renders what the editor can produce', () => {
    const html = renderAnswerHtml({ type: 'doc', content: [para(text('hello ', [{ type: 'bold' }]), text('world'))] });
    expect(html).toContain('<strong>hello </strong>');
    expect(html).toContain('world');
  });

  it('escapes markup typed as text', () => {
    const html = renderAnswerHtml({ type: 'doc', content: [para(text('<img src=x onerror=alert(1)><script>alert(1)</script>'))] });
    expect(html).not.toMatch(/<img|<script/i);
    expect(html).toContain('&lt;img');
  });

  it('drops javascript: links and keeps safe ones opening in a new tab', () => {
    const link = (href: string) => [{ type: 'link', attrs: { href } }];
    const bad = renderAnswerHtml({ type: 'doc', content: [para(text('x', link('javascript:alert(1)')))] });
    expect(bad).not.toMatch(/javascript:/i);
    const ok = renderAnswerHtml({ type: 'doc', content: [para(text('x', link('https://example.com')))] });
    expect(ok).toContain('href="https://example.com"');
    expect(ok).toContain('rel="noopener noreferrer nofollow"');
  });

  it('returns null for documents the editor schema cannot hold, instead of throwing', () => {
    expect(renderAnswerHtml(null)).toBeNull();
    expect(renderAnswerHtml({ type: 'doc', content: [{ type: 'iframe', attrs: { src: 'https://evil.example' } }] })).toBeNull();
    expect(renderAnswerHtml('not a document' as never)).toBeNull();
  });

  it('does not render stored rich_text_html at all (only the document)', () => {
    const answer = { rich_text_json: { type: 'doc', content: [para(text('real answer'))] }, rich_text_html: '<p>fake answer</p>' };
    const html = renderAnswerHtml(answer.rich_text_json);
    expect(html).toContain('real answer');
    expect(html).not.toContain('fake answer');
  });
});
