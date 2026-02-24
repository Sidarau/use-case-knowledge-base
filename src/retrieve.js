import { getDb } from './db.js';
import { embedQuery, deserializeEmbedding } from './embed.js';

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Search the knowledge base.
 * Returns top results with source info, deduped per source.
 */
export async function query(question, topK = 10) {
  const db = getDb();

  // Embed the query
  const { embedding: qEmb, dim: qDim } = await embedQuery(question);

  // Load all chunks with matching dimensions
  const rows = db.prepare(`
    SELECT c.id, c.source_id, c.chunk_index, c.content, c.embedding, c.embedding_dim,
           s.url, s.title, s.source_type, s.metadata
    FROM chunks c
    JOIN sources s ON c.source_id = s.id
    WHERE c.embedding_dim = ?
  `).all(qDim);

  if (rows.length === 0) return [];

  // Score each chunk
  const scored = rows.map(row => {
    const chunkEmb = deserializeEmbedding(row.embedding);
    const score = cosineSimilarity(qEmb, chunkEmb);
    return { ...row, score, embedding: undefined };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Per-source dedup: keep best chunk per source
  const seen = new Set();
  const results = [];
  for (const item of scored) {
    if (seen.has(item.source_id)) continue;
    seen.add(item.source_id);
    // Sanitize content (max 2500 chars)
    const excerpt = item.content.length > 2500
      ? item.content.slice(0, 2500) + '…'
      : item.content;
    results.push({
      source_id: item.source_id,
      chunk_id: item.id,
      chunk_index: item.chunk_index,
      score: item.score,
      excerpt,
      url: item.url,
      title: item.title,
      source_type: item.source_type,
      metadata: item.metadata ? JSON.parse(item.metadata) : {},
    });
    if (results.length >= topK) break;
  }

  return results;
}
