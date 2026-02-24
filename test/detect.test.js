import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectSourceType } from '../src/detect.js';

describe('detectSourceType', () => {
  it('returns text for null or undefined', () => {
    assert.strictEqual(detectSourceType(null), 'text');
    assert.strictEqual(detectSourceType(undefined), 'text');
  });

  it('detects tweet URLs from x.com', () => {
    assert.strictEqual(
      detectSourceType('https://x.com/user/status/123456'),
      'tweet'
    );
    assert.strictEqual(
      detectSourceType('http://x.com/username/status/789012345'),
      'tweet'
    );
  });

  it('detects tweet URLs from twitter.com', () => {
    assert.strictEqual(
      detectSourceType('https://twitter.com/user/status/123456'),
      'tweet'
    );
    assert.strictEqual(
      detectSourceType('http://twitter.com/username/status/789012345'),
      'tweet'
    );
  });

  it('detects tweet URLs with www prefix', () => {
    assert.strictEqual(
      detectSourceType('https://www.x.com/user/status/123456'),
      'tweet'
    );
    assert.strictEqual(
      detectSourceType('https://www.twitter.com/user/status/123456'),
      'tweet'
    );
  });

  it('detects YouTube video URLs', () => {
    assert.strictEqual(
      detectSourceType('https://youtube.com/watch?v=abc123'),
      'video'
    );
    assert.strictEqual(
      detectSourceType('http://youtube.com/watch?v=xyz789'),
      'video'
    );
  });

  it('detects YouTube short URLs (youtu.be)', () => {
    assert.strictEqual(
      detectSourceType('https://youtu.be/abc123'),
      'video'
    );
    assert.strictEqual(
      detectSourceType('http://youtu.be/xyz789'),
      'video'
    );
  });

  it('detects YouTube shorts URLs', () => {
    assert.strictEqual(
      detectSourceType('https://youtube.com/shorts/abc123'),
      'video'
    );
    assert.strictEqual(
      detectSourceType('https://www.youtube.com/shorts/xyz789'),
      'video'
    );
  });

  it('detects PDF files by extension', () => {
    assert.strictEqual(
      detectSourceType('https://example.com/document.pdf'),
      'pdf'
    );
    assert.strictEqual(
      detectSourceType('http://example.com/files/report.pdf'),
      'pdf'
    );
  });

  it('detects PDF with query parameters', () => {
    assert.strictEqual(
      detectSourceType('https://example.com/document.pdf?download=1'),
      'pdf'
    );
  });

  it('detects article URLs (generic HTTP/HTTPS)', () => {
    assert.strictEqual(
      detectSourceType('https://example.com/article'),
      'article'
    );
    assert.strictEqual(
      detectSourceType('http://blog.example.com/post'),
      'article'
    );
    assert.strictEqual(
      detectSourceType('https://news.site.com/story/123'),
      'article'
    );
  });

  it('returns other for non-HTTP URLs', () => {
    assert.strictEqual(detectSourceType('/local/path/file.txt'), 'other');
    assert.strictEqual(detectSourceType('ftp://example.com/file.txt'), 'other');
    assert.strictEqual(detectSourceType('file:///home/user/doc.txt'), 'other');
  });

  it('returns text for empty string (falsy check)', () => {
    assert.strictEqual(detectSourceType(''), 'text');
  });

  it('prioritizes specific types over generic article', () => {
    // Tweet should be detected before article
    assert.strictEqual(
      detectSourceType('https://x.com/user/status/123'),
      'tweet'
    );
    // Video should be detected before article
    assert.strictEqual(
      detectSourceType('https://youtube.com/watch?v=abc'),
      'video'
    );
    // PDF should be detected before article
    assert.strictEqual(
      detectSourceType('https://example.com/doc.pdf'),
      'pdf'
    );
  });
});
