const TWITTER_RE = /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+\/status\/\d+/i;
const YOUTUBE_RE = /^https?:\/\/(www\.)?(youtube\.com\/watch\?|youtu\.be\/|youtube\.com\/shorts\/)/i;
const PDF_RE     = /\.pdf(\?.*)?$/i;

export function detectSourceType(url) {
  if (!url) return 'text';
  if (TWITTER_RE.test(url))  return 'tweet';
  if (YOUTUBE_RE.test(url))  return 'video';
  if (PDF_RE.test(url))      return 'pdf';
  if (/^https?:\/\//i.test(url)) return 'article';
  return 'other';
}
