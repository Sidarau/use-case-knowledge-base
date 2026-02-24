const ERROR_SIGNALS = [
  'access denied', 'captcha', 'please enable javascript',
  'cloudflare', '404', 'sign in', 'blocked', 'rate limit',
];

export function validateContent(content, sourceType, metadata = {}) {
  if (!content || content.length < 20) {
    return { valid: false, reason: 'Content too short (< 20 chars)' };
  }

  const allowShortVideo = sourceType === 'video' && metadata?.has_transcript;
  const minLength = allowShortVideo ? 200 : 500;

  if (sourceType !== 'tweet' && content.length < minLength) {
    return { valid: false, reason: `Content too short for ${sourceType} (< ${minLength} chars)` };
  }

  // Prose detection for articles (non-tweets): >= 15% of paragraphs > 80 chars
  // We join consecutive lines into paragraphs (split on blank lines) to handle
  // extractors that wrap text at shorter widths.
  if (sourceType !== 'tweet') {
    const paragraphs = content
      .split(/\n\s*\n/)
      .map(p => p.replace(/\n/g, ' ').trim())
      .filter(p => p.length > 0);
    if (paragraphs.length > 0) {
      const longParas = paragraphs.filter(p => p.length > 80).length;
      const ratio = longParas / paragraphs.length;
      if (ratio < 0.15) {
        return { valid: false, reason: `Low prose ratio (${(ratio * 100).toFixed(1)}% < 15%)` };
      }
    }
  }

  // Error page detection: 2+ signals
  const lower = content.toLowerCase();
  const hits = ERROR_SIGNALS.filter(s => lower.includes(s));
  if (hits.length >= 2) {
    return { valid: false, reason: `Looks like an error page (signals: ${hits.join(', ')})` };
  }

  return { valid: true };
}

export function truncateContent(content, max = 200_000) {
  return content.length > max ? content.slice(0, max) : content;
}
