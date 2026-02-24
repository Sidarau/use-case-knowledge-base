import { createHash, randomUUID } from 'crypto';
import { getDb } from './db.js';
import { detectSourceType } from './detect.js';
import { normalizeUrl } from './normalize.js';
import { extractContent } from './extract.js';
import { validateContent, truncateContent } from './validate.js';
import { chunkText } from './chunk.js';
import { embedTexts, serializeEmbedding } from './embed.js';
import { acquireLock } from './lock.js';

export async function ingest(rawUrl) {
  const release = acquireLock();
  try {
    return await _ingest(rawUrl);
  } finally {
    release();
  }
}

async function _ingest(rawUrl) {
  const db = getDb();
  const url = normalizeUrl(rawUrl);
  const sourceType = detectSourceType(url);

  console.log(`  Type: ${sourceType}`);
  console.log(`  URL:  ${url}`);

  // URL dedup
  const existing = db.prepare('SELECT id, title FROM sources WHERE url = ?').get(url);
  if (existing) {
    return { status: 'duplicate_url', message: `Already ingested: "${existing.title}" (${existing.id})` };
  }

  // Extract content
  console.log('  Extracting content...');
  const { title, content: rawContent, metadata = {} } = await extractContent(url, sourceType);
  const content = truncateContent(rawContent);

  // Validate
  const validation = validateContent(content, sourceType, metadata);
  if (!validation.valid && content.length > 0) {
    return { status: 'invalid', message: validation.reason };
  }

  // Content hash dedup (only if content exists)
  let contentHash = null;
  if (content.length > 0) {
    contentHash = createHash('sha256').update(content).digest('hex');
    const hashDup = db.prepare('SELECT id, url, title FROM sources WHERE content_hash = ?').get(contentHash);
    if (hashDup) {
      return {
        status: 'duplicate_content',
        message: `Same content exists: "${hashDup.title}" (${hashDup.url})`,
      };
    }
  }

  // Chunk (only if content exists)
  const chunks = content.length > 0 ? chunkText(content) : [];
  if (chunks.length > 0) {
    console.log('  Chunking...');
    console.log(`  ${chunks.length} chunk(s)`);
  }

  // Embed (only if chunks exist)
  let embeddings = [], dim = 0, provider = null, model = null;
  if (chunks.length > 0) {
    console.log('  Generating embeddings...');
    const result = await embedTexts(chunks);
    embeddings = result.embeddings;
    dim = result.dim;
    provider = result.provider;
    model = result.model;
    console.log(`  Provider: ${provider}/${model} (${dim}d)`);
  }

  // Store in a transaction
  const sourceId = randomUUID();
  const now = new Date().toISOString();

  const insertSource = db.prepare(`
    INSERT INTO sources (id, url, title, source_type, raw_content, content_hash, metadata, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
  `);

  const insertChunk = db.prepare(`
    INSERT INTO chunks (id, source_id, chunk_index, content, embedding, embedding_dim, embedding_provider, embedding_model, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    insertSource.run(sourceId, url, title, sourceType, content, contentHash, JSON.stringify(metadata), now, now);
    for (let i = 0; i < chunks.length; i++) {
      insertChunk.run(
        randomUUID(), sourceId, i, chunks[i],
        serializeEmbedding(embeddings[i]), dim, provider, model, now
      );
    }
  });

  tx();

  return {
    status: content.length > 0 ? 'ok' : 'pending_transcript',
    sourceId,
    title,
    sourceType,
    chunks: chunks.length,
    provider: model ? `${provider}/${model}` : null,
    metadata
  };
}
