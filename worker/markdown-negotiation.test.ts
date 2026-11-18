import { describe, expect, it } from 'vitest';
import { maybeMarkdown } from './markdown-negotiation';

const html = '<title>Map</title><main><h1>Explore</h1><p>Public land</p></main>';
const request = (accept?: string, method = 'GET') => new Request('https://freehuntingmap.com/', { method, headers: accept ? { Accept: accept } : {} });
const page = () => new Response(html, { headers: { 'Content-Type': 'text/html', Vary: 'Origin' } });

describe('markdown negotiation', () => {
  it('converts requested HTML and preserves existing Vary', async () => {
    const response = await maybeMarkdown(request('text/x-markdown'), page());
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('vary')).toBe('Origin, Accept');
    expect(await response.text()).toContain('# Explore');
  });

  it('keeps HTML by default, when preferred, or when markdown is unacceptable', async () => {
    for (const accept of [undefined, 'text/html, text/markdown;q=0.5', 'text/markdown;q=0']) {
      const response = await maybeMarkdown(request(accept), page());
      expect(response.headers.get('content-type')).toBe('text/html');
      expect(await response.text()).toBe(html);
    }
  });

  it('does not convert non-HTML, errors, redirects, or other methods', async () => {
    for (const response of [new Response('{}', { headers: { 'Content-Type': 'application/json' } }), new Response(html, { status: 404, headers: { 'Content-Type': 'text/html' } }), Response.redirect('https://freehuntingmap.com/elsewhere')]) {
      expect(await maybeMarkdown(request('text/markdown'), response)).toBe(response);
    }
    const response = page();
    expect(await maybeMarkdown(request('text/markdown', 'POST'), response)).toBe(response);
  });

  it('returns markdown headers without a body for HEAD', async () => {
    const response = await maybeMarkdown(request('text/markdown', 'HEAD'), page());
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await response.text()).toBe('');
  });
});
