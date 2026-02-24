import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeUrl } from '../src/normalize.js';

describe('normalizeUrl', () => {
  it('returns raw input for invalid URLs', () => {
    assert.strictEqual(normalizeUrl(null), null);
    assert.strictEqual(normalizeUrl(undefined), undefined);
    assert.strictEqual(normalizeUrl(''), '');
    assert.strictEqual(normalizeUrl('not-a-url'), 'not-a-url');
    assert.strictEqual(normalizeUrl('ftp://example.com'), 'ftp://example.com');
  });

  it('strips tracking parameters', () => {
    const base = 'https://example.com/article';
    assert.strictEqual(
      normalizeUrl(`${base}?utm_source=email`),
      base
    );
    assert.strictEqual(
      normalizeUrl(`${base}?utm_medium=social&utm_campaign=summer`),
      base
    );
    assert.strictEqual(
      normalizeUrl(`${base}?fbclid=abc123`),
      base
    );
    assert.strictEqual(
      normalizeUrl(`${base}?igshid=xyz789`),
      base
    );
    assert.strictEqual(
      normalizeUrl(`${base}?ref=home`),
      base
    );
    assert.strictEqual(
      normalizeUrl(`${base}?s=search&t=results`),
      base
    );
  });

  it('strips multiple tracking params at once', () => {
    const url = 'https://example.com/article?utm_source=email&utm_medium=social&fbclid=abc123&ref=home';
    assert.strictEqual(normalizeUrl(url), 'https://example.com/article');
  });

  it('preserves non-tracking query parameters', () => {
    assert.strictEqual(
      normalizeUrl('https://example.com/article?id=123'),
      'https://example.com/article?id=123'
    );
    assert.strictEqual(
      normalizeUrl('https://example.com/search?q=javascript&page=2'),
      'https://example.com/search?page=2&q=javascript'
    );
  });

  it('removes www. prefix', () => {
    assert.strictEqual(
      normalizeUrl('https://www.example.com/article'),
      'https://example.com/article'
    );
    assert.strictEqual(
      normalizeUrl('http://www.twitter.com/post'),
      'http://x.com/post'
    );
  });

  it('normalizes twitter.com to x.com', () => {
    assert.strictEqual(
      normalizeUrl('https://twitter.com/user/status/123'),
      'https://x.com/user/status/123'
    );
    assert.strictEqual(
      normalizeUrl('http://twitter.com/home'),
      'http://x.com/home'
    );
  });

  it('does not change x.com URLs', () => {
    assert.strictEqual(
      normalizeUrl('https://x.com/user/status/123'),
      'https://x.com/user/status/123'
    );
  });

  it('removes trailing slashes', () => {
    assert.strictEqual(
      normalizeUrl('https://example.com/article/'),
      'https://example.com/article'
    );
    assert.strictEqual(
      normalizeUrl('https://example.com/'),
      'https://example.com/'
    );
  });

  it('removes fragments', () => {
    assert.strictEqual(
      normalizeUrl('https://example.com/article#section-1'),
      'https://example.com/article'
    );
    assert.strictEqual(
      normalizeUrl('https://example.com/article#'),
      'https://example.com/article'
    );
  });

  it('sorts remaining query parameters for consistency', () => {
    assert.strictEqual(
      normalizeUrl('https://example.com/article?z=last&a=first'),
      'https://example.com/article?a=first&z=last'
    );
  });

  it('handles complex URLs with multiple transformations', () => {
    const input = 'https://www.twitter.com/user/status/123?utm_source=email&ref=home#comments';
    assert.strictEqual(
      normalizeUrl(input),
      'https://x.com/user/status/123'
    );
  });

  it('handles URLs with only tracking params and non-tracking params mixed', () => {
    const input = 'https://example.com/article?id=123&utm_source=email&page=2';
    assert.strictEqual(
      normalizeUrl(input),
      'https://example.com/article?id=123&page=2'
    );
  });
});
