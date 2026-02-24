const MAX_INPUT = 8000;
const BATCH_SIZE = 10;
const BATCH_DELAY = 200;

// ---------- LRU Cache ----------

class LRUCache {
  constructor(max = 1000) {
    this.max = max;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }
  set(key, val) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
    this.map.set(key, val);
  }
}

const cache = new LRUCache(1000);

// ---------- Retry with backoff ----------

async function retry(fn, attempts = 3, delays = [1000, 2000, 4000]) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise(r => setTimeout(r, delays[i]));
    }
  }
}

// ---------- Gemini ----------

async function embedGemini(texts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');

  const requests = texts.map(t => ({
    model: 'models/text-embedding-004',
    content: { parts: [{ text: t.slice(0, MAX_INPUT) }] },
  }));

  const res = await retry(async () => {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Gemini API ${r.status}: ${body.slice(0, 200)}`);
    }
    return r.json();
  });

  return {
    embeddings: res.embeddings.map(e => e.values),
    dim: res.embeddings[0].values.length,
    provider: 'google',
    model: 'text-embedding-004',
  };
}

// ---------- OpenAI ----------

async function embedOpenAI(texts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');

  const res = await retry(async () => {
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: texts.map(t => t.slice(0, MAX_INPUT)),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`OpenAI API ${r.status}: ${body.slice(0, 200)}`);
    }
    return r.json();
  });

  const sorted = res.data.sort((a, b) => a.index - b.index);
  return {
    embeddings: sorted.map(d => d.embedding),
    dim: sorted[0].embedding.length,
    provider: 'openai',
    model: 'text-embedding-3-small',
  };
}

// ---------- Public API ----------

/**
 * Embed an array of text strings.
 * Returns { embeddings: number[][], dim, provider, model }
 */
export async function embedTexts(texts) {
  // Check cache first
  const results = new Array(texts.length);
  const uncached = [];
  const uncachedIdx = [];

  for (let i = 0; i < texts.length; i++) {
    const cached = cache.get(texts[i]);
    if (cached) {
      results[i] = cached;
    } else {
      uncached.push(texts[i]);
      uncachedIdx.push(i);
    }
  }

  if (uncached.length === 0) {
    return {
      embeddings: results.map(r => r.embedding),
      dim: results[0].dim,
      provider: results[0].provider,
      model: results[0].model,
    };
  }

  // Process in batches
  let provider, model, dim;
  for (let b = 0; b < uncached.length; b += BATCH_SIZE) {
    const batch = uncached.slice(b, b + BATCH_SIZE);
    const batchIdxs = uncachedIdx.slice(b, b + BATCH_SIZE);

    let result;
    try {
      result = await embedGemini(batch);
    } catch (geminiErr) {
      try {
        result = await embedOpenAI(batch);
      } catch (openaiErr) {
        throw new Error(
          `Embedding failed.\n  Gemini: ${geminiErr.message}\n  OpenAI: ${openaiErr.message}`
        );
      }
    }

    provider = result.provider;
    model = result.model;
    dim = result.dim;

    for (let j = 0; j < batch.length; j++) {
      const entry = { embedding: result.embeddings[j], dim, provider, model };
      results[batchIdxs[j]] = entry;
      cache.set(batch[j], entry);
    }

    // Delay between batches
    if (b + BATCH_SIZE < uncached.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }

  return {
    embeddings: results.map(r => r.embedding),
    dim,
    provider,
    model,
  };
}

/**
 * Embed a single query string.
 */
export async function embedQuery(text) {
  const result = await embedTexts([text]);
  return {
    embedding: result.embeddings[0],
    dim: result.dim,
    provider: result.provider,
    model: result.model,
  };
}

/**
 * Serialize embedding array to Buffer for SQLite storage.
 */
export function serializeEmbedding(arr) {
  return Buffer.from(new Float32Array(arr).buffer);
}

/**
 * Deserialize Buffer back to number array.
 */
export function deserializeEmbedding(buf) {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f32);
}
