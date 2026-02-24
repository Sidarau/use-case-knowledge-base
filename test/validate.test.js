import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateContent } from '../src/validate.js';

describe('validateContent', () => {
  describe('length checks', () => {
    it('rejects null content', () => {
      const result = validateContent(null, 'article');
      assert.strictEqual(result.valid, false);
      assert.ok(result.reason.includes('too short'));
    });

    it('rejects undefined content', () => {
      const result = validateContent(undefined, 'article');
      assert.strictEqual(result.valid, false);
      assert.ok(result.reason.includes('too short'));
    });

    it('rejects empty content', () => {
      const result = validateContent('', 'article');
      assert.strictEqual(result.valid, false);
      assert.ok(result.reason.includes('too short'));
    });

    it('rejects content shorter than 20 chars', () => {
      const result = validateContent('Short text', 'article');
      assert.strictEqual(result.valid, false);
      assert.ok(result.reason.includes('too short'));
      assert.ok(result.reason.includes('20'));
    });

    it('rejects non-tweet content shorter than 500 chars', () => {
      const content = 'a'.repeat(100);
      const result = validateContent(content, 'article');
      assert.strictEqual(result.valid, false);
      assert.ok(result.reason.includes('too short'));
      assert.ok(result.reason.includes('500'));
    });

    it('accepts non-tweet content with exactly 500 chars', () => {
      const content = generateValidContent(500);
      const result = validateContent(content, 'article');
      assert.strictEqual(result.valid, true);
    });

    it('accepts non-tweet content longer than 500 chars', () => {
      const content = generateValidContent(600);
      const result = validateContent(content, 'article');
      assert.strictEqual(result.valid, true);
    });

    it('accepts tweet content with 20 chars (tweets bypass 500 char check)', () => {
      const result = validateContent('Short tweet content here', 'tweet');
      assert.strictEqual(result.valid, true);
    });

    it('accepts tweet content with 100 chars', () => {
      const result = validateContent('This is a tweet that is longer but still under five hundred characters for testing.', 'tweet');
      assert.strictEqual(result.valid, true);
    });
  });

  describe('prose ratio detection', () => {
    it('accepts content with good prose ratio (>= 15%)', () => {
      const content = generateValidContent(600);
      const result = validateContent(content, 'article');
      assert.strictEqual(result.valid, true);
    });

    it('rejects content with low prose ratio (< 15%)', () => {
      // Create content with mostly short lines
      const shortLines = Array(100).fill('Hi.').join('\n\n');
      const content = shortLines + '\n\n' + 'This is a longer paragraph that is over eighty characters in length to help prose.';
      const result = validateContent(content, 'article');
      assert.strictEqual(result.valid, false);
      assert.ok(result.reason.includes('prose'));
    });

    it('skips prose check for tweets', () => {
      // Tweets with low prose ratio should still pass (they skip prose check)
      // Need 20+ chars to pass minimum length
      const shortContent = 'Hi there. Bye now. Ok then. This is a tweet.';
      const result = validateContent(shortContent, 'tweet');
      assert.strictEqual(result.valid, true);
    });

    it('handles content with no paragraphs', () => {
      const content = 'a'.repeat(500);
      const result = validateContent(content, 'article');
      // Single paragraph over 80 chars = 100% long paragraphs
      assert.strictEqual(result.valid, true);
    });

    it('correctly calculates prose ratio with consecutive lines joined', () => {
      // Lines joined into paragraphs, inner newlines replaced with spaces
      const content = `First line of paragraph one.
Second line of paragraph one.

First line of paragraph two.
Second line of paragraph two.` + 'a'.repeat(500);
      const result = validateContent(content, 'article');
      // Both paragraphs should be > 80 chars after joining
      assert.strictEqual(result.valid, true);
    });
  });

  describe('error signal detection', () => {
    it('accepts content with no error signals', () => {
      const content = generateValidContent(500);
      const result = validateContent(content, 'article');
      assert.strictEqual(result.valid, true);
    });

    it('accepts content with 1 error signal', () => {
      const content = generateValidContent(500) + ' 404 page';
      const result = validateContent(content, 'article');
      assert.strictEqual(result.valid, true);
    });

    it('rejects content with 2 error signals', () => {
      const content = generateValidContent(500) + ' access denied and captcha detected';
      const result = validateContent(content, 'article');
      assert.strictEqual(result.valid, false);
      assert.ok(result.reason.includes('error page'));
      assert.ok(result.reason.includes('access denied'));
      assert.ok(result.reason.includes('captcha'));
    });

    it('rejects content with 3+ error signals', () => {
      const content = generateValidContent(500) + ' access denied captcha cloudflare';
      const result = validateContent(content, 'article');
      assert.strictEqual(result.valid, false);
      assert.ok(result.reason.includes('error page'));
    });

    it('detects case-insensitive error signals', () => {
      const content = generateValidContent(500) + ' ACCESS DENIED CAPTCHA';
      const result = validateContent(content, 'article');
      assert.strictEqual(result.valid, false);
    });

    it('detects mixed case error signals', () => {
      const content = generateValidContent(500) + ' Access Denied rate limit';
      const result = validateContent(content, 'article');
      assert.strictEqual(result.valid, false);
    });

    it('detects all error signals from the list', () => {
      const signals = [
        ['access denied', 'captcha'],
        ['cloudflare', '404'],
        ['sign in', 'blocked'],
        ['please enable javascript', 'rate limit']
      ];
      
      for (const [sig1, sig2] of signals) {
        const content = generateValidContent(500) + ` ${sig1} ${sig2}`;
        const result = validateContent(content, 'article');
        assert.strictEqual(result.valid, false, `Should detect ${sig1} and ${sig2}`);
      }
    });
  });

  describe('source type handling', () => {
    it('handles pdf source type with 500+ char requirement', () => {
      const content = generateValidContent(500);
      const result = validateContent(content, 'pdf');
      assert.strictEqual(result.valid, true);
    });

    it('handles video source type with 500+ char requirement', () => {
      const content = generateValidContent(500);
      const result = validateContent(content, 'video');
      assert.strictEqual(result.valid, true);
    });

    it('handles text source type with 500+ char requirement', () => {
      const content = generateValidContent(500);
      const result = validateContent(content, 'text');
      assert.strictEqual(result.valid, true);
    });

    it('handles other source type with 500+ char requirement', () => {
      const content = generateValidContent(500);
      const result = validateContent(content, 'other');
      assert.strictEqual(result.valid, true);
    });
  });

  describe('complex scenarios', () => {
    it('fails for short content even with error signals', () => {
      const content = '404 error page not found captcha required';
      const result = validateContent(content, 'article');
      // Should fail on length first
      assert.strictEqual(result.valid, false);
      assert.ok(result.reason.includes('too short'));
    });

    it('validates long article content successfully', () => {
      const content = generateValidArticle();
      const result = validateContent(content, 'article');
      assert.strictEqual(result.valid, true);
    });

    it('validates tweet content with minimum length', () => {
      const content = 'Just a short tweet here for testing purposes!';
      const result = validateContent(content, 'tweet');
      assert.strictEqual(result.valid, true);
    });
  });
});

// Helper functions
function generateValidContent(length) {
  // Generate content with good prose ratio
  const sentence = 'This is a sentence that contains enough characters to make a decent paragraph. ';
  const paragraphs = [];
  let remaining = length;
  
  while (remaining > 0) {
    let para = '';
    while (para.length < 150 && remaining > 0) {
      para += sentence;
      remaining -= sentence.length;
    }
    paragraphs.push(para.trim());
  }
  
  return paragraphs.join('\n\n');
}

function generateValidArticle() {
  return `This is the introduction paragraph for the article. It contains enough text to be considered a proper paragraph with good prose ratio for validation purposes.

Here is the second paragraph with more detailed information about the topic being discussed. This paragraph is also long enough to contribute positively to the prose ratio calculation.

The third paragraph provides additional context and examples that help illustrate the main points of the article. Having multiple paragraphs helps demonstrate the prose detection logic.

Finally, this concluding paragraph wraps up the discussion with some final thoughts and takeaways for the reader. The article now has sufficient length and quality to pass all validation checks.`;
}
