#!/usr/bin/env node

import { getDb, closeDb } from './db.js';
import { ingest } from './ingest.js';
import { query } from './retrieve.js';

const [,, cmd, ...args] = process.argv;

const USAGE = `Usage:
  kb ingest <url>       Ingest a URL into the knowledge base
  kb list               List all ingested sources
  kb delete <id>        Delete a source (and its chunks)
  kb query <question>   Search the knowledge base`;

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(USAGE);
    return;
  }

  switch (cmd) {
    case 'ingest': {
      const url = args.join(' ');
      if (!url) { console.error('Error: URL required.\n' + USAGE); process.exit(1); }
      console.log(`Ingesting: ${url}`);
      const result = await ingest(url);
      if (result.status === 'ok') {
        console.log(`\n✅ Ingested: "${result.title}"`);
        console.log(`   ID:     ${result.sourceId}`);
        console.log(`   Type:   ${result.sourceType}`);
        console.log(`   Chunks: ${result.chunks}`);
        console.log(`   Embed:  ${result.provider}`);
      } else if (result.status === 'duplicate_url' || result.status === 'duplicate_content') {
        console.log(`\n⚠️  Duplicate: ${result.message}`);
      } else {
        console.error(`\n❌ Failed: ${result.message}`);
        process.exit(1);
      }
      break;
    }

    case 'list': {
      const db = getDb();
      const sources = db.prepare(`
        SELECT s.id, s.url, s.title, s.source_type, s.created_at,
               (SELECT COUNT(*) FROM chunks c WHERE c.source_id = s.id) as chunk_count
        FROM sources s
        ORDER BY s.created_at DESC
      `).all();
      if (sources.length === 0) {
        console.log('No sources ingested yet.');
      } else {
        console.log(`${sources.length} source(s):\n`);
        for (const s of sources) {
          console.log(`  ${s.id.slice(0, 8)}  [${s.source_type}]  ${s.title || '(untitled)'}`);
          console.log(`           ${s.url || '(no url)'}`);
          console.log(`           ${s.chunk_count} chunks · ${s.created_at}`);
          console.log();
        }
      }
      break;
    }

    case 'delete': {
      const id = args[0];
      if (!id) { console.error('Error: Source ID required.\n' + USAGE); process.exit(1); }
      const db = getDb();
      // Support partial ID match
      const source = db.prepare('SELECT id, title FROM sources WHERE id = ? OR id LIKE ?').get(id, id + '%');
      if (!source) {
        console.error(`Source not found: ${id}`);
        process.exit(1);
      }
      db.prepare('DELETE FROM sources WHERE id = ?').run(source.id);
      console.log(`🗑️  Deleted: "${source.title}" (${source.id})`);
      break;
    }

    case 'query': {
      const question = args.join(' ');
      if (!question) { console.error('Error: Question required.\n' + USAGE); process.exit(1); }
      console.log(`Searching: "${question}"\n`);
      const results = await query(question);
      if (results.length === 0) {
        console.log('No results found.');
      } else {
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          console.log(`${i + 1}. [${r.score.toFixed(3)}] ${r.title || '(untitled)'}`);
          console.log(`   ${r.url || '(no url)'}`);
          console.log(`   ${r.excerpt.slice(0, 200)}${r.excerpt.length > 200 ? '…' : ''}`);
          console.log();
        }
      }
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}\n${USAGE}`);
      process.exit(1);
  }
}

main()
  .catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  })
  .finally(() => closeDb());
