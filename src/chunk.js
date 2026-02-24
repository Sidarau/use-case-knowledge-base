const CHUNK_SIZE = 800;
const OVERLAP = 200;
const MIN_CHUNK = 100;
const SENTENCE_RE = /(?<=[.!?])\s+/;

export function chunkText(text) {
  if (!text || text.length < MIN_CHUNK) return text ? [text] : [];

  // Split into sentences
  const sentences = text.split(SENTENCE_RE).filter(s => s.trim().length > 0);
  if (sentences.length === 0) return [text];

  const chunks = [];
  let current = '';
  let overlapBuffer = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > CHUNK_SIZE && current.length >= MIN_CHUNK) {
      chunks.push(current.trim());
      // Build overlap from end of current chunk
      overlapBuffer = current.slice(-OVERLAP);
      current = overlapBuffer + sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }

  // Handle last chunk
  if (current.trim().length > 0) {
    if (current.trim().length < MIN_CHUNK && chunks.length > 0) {
      // Append tiny remainder to last chunk
      chunks[chunks.length - 1] += ' ' + current.trim();
    } else {
      chunks.push(current.trim());
    }
  }

  return chunks;
}
