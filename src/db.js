import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { homedir } from 'os';

const DATA_DIR = process.env.KB_DATA_DIR || join(homedir(), '.kb-drops');
const DB_PATH = join(DATA_DIR, 'kb.db');

let _db;

export function getDataDir() { return DATA_DIR; }

export function getDb() {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 30000');
  migrate(_db);
  return _db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      url TEXT,
      title TEXT,
      source_type TEXT,
      summary TEXT,
      raw_content TEXT,
      content_hash TEXT UNIQUE,
      metadata TEXT, -- JSON object
      tags TEXT,  -- JSON array
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT REFERENCES sources(id) ON DELETE CASCADE,
      chunk_index INTEGER,
      content TEXT,
      embedding BLOB,
      embedding_dim INTEGER,
      embedding_provider TEXT,
      embedding_model TEXT,
      created_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_source_id ON chunks(source_id);
    CREATE INDEX IF NOT EXISTS idx_sources_source_type ON sources(source_type);

    CREATE TABLE IF NOT EXISTS source_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      label_key TEXT NOT NULL,
      label_value TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_id, label_key, label_value)
    );

    CREATE INDEX IF NOT EXISTS idx_source_labels_source ON source_labels(source_id);
    CREATE INDEX IF NOT EXISTS idx_source_labels_kv ON source_labels(label_key, label_value);

    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT REFERENCES sources(id) ON DELETE CASCADE,
      analysis_type TEXT NOT NULL,
      model TEXT,
      prompt_version TEXT,
      output_markdown TEXT,
      output_json TEXT,
      confidence REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_id, analysis_type)
    );

    CREATE INDEX IF NOT EXISTS idx_analyses_source ON analyses(source_id);
    CREATE INDEX IF NOT EXISTS idx_analyses_type ON analyses(analysis_type);

    CREATE TABLE IF NOT EXISTS analysis_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      level_type TEXT NOT NULL,
      level_value REAL NOT NULL,
      horizon TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_analysis_levels_symbol ON analysis_levels(symbol);

    CREATE TABLE IF NOT EXISTS consolidated_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      model TEXT,
      prompt_version TEXT,
      output_markdown TEXT,
      output_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_consolidated_created ON consolidated_reports(created_at);

    CREATE TABLE IF NOT EXISTS price_alert_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_level_id INTEGER REFERENCES analysis_levels(id) ON DELETE SET NULL,
      symbol TEXT NOT NULL,
      level_type TEXT NOT NULL,
      level_value REAL NOT NULL,
      price REAL NOT NULL,
      direction TEXT NOT NULL,
      trigger_day TEXT NOT NULL,
      message TEXT,
      triggered_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(symbol, level_type, level_value, direction, trigger_day)
    );

    CREATE INDEX IF NOT EXISTS idx_price_alert_symbol ON price_alert_events(symbol);
  `);
}

export function closeDb() {
  if (_db) { _db.close(); _db = null; }
}
