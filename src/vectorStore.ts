import path from 'path';
import { connect, Table } from '@lancedb/lancedb';
import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';

const DB_DIR = process.env.LANCE_PATH || './data/lancedb';
const TABLE_NAME = 'videos';
const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2'; // 384-dim, ~23MB download on first run

let _embedder: FeatureExtractionPipeline | null = null;
let _table: Table | null = null;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!_embedder) {
    _embedder = await pipeline('feature-extraction', EMBED_MODEL, { revision: 'main' });
  }
  return _embedder;
}

async function getTable(): Promise<Table> {
  if (_table) return _table;

  const db = await connect(path.resolve(DB_DIR));
  const tableNames = await db.tableNames();

  if (tableNames.includes(TABLE_NAME)) {
    _table = await db.openTable(TABLE_NAME);
  } else {
    // Create with a dummy row to establish schema; deleted immediately after
    _table = await db.createTable(TABLE_NAME, [
      {
        id: '__init__',
        text: '',
        vector: new Array(384).fill(0) as number[],
        source_tab: '',
        content_type: '',
        tags: '',
      },
    ]);
    await _table.delete('id = "__init__"');
  }

  return _table;
}

async function embed(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

export interface VectorRecord {
  id: string;
  text: string;
  vector: number[];
  source_tab: string;
  content_type: string;
  tags: string;
}

export interface SearchResult {
  id: string;
  text: string;
  source_tab: string;
  content_type: string;
  tags: string;
  score: number;
}

export async function upsertVector(
  id: string,
  summary: string,
  tags: string[],
  sourceTab: string,
  contentType: string,
): Promise<void> {
  const table = await getTable();
  const text = [summary, ...tags].join(' ');
  const vector = await embed(text);

  // Delete existing row first (LanceDB has no native upsert)
  await table.delete(`id = "${id}"`);
  await table.add([{ id, text, vector, source_tab: sourceTab, content_type: contentType, tags: tags.join(',') }]);
}

export async function semanticSearch(
  query: string,
  limit = 10,
  filter?: { sourceTab?: string; contentType?: string },
): Promise<SearchResult[]> {
  const table = await getTable();
  const vector = await embed(query);

  let q = table.vectorSearch(vector).limit(limit);

  // Build filter string
  const parts: string[] = [];
  if (filter?.sourceTab) parts.push(`source_tab = "${filter.sourceTab}"`);
  if (filter?.contentType) parts.push(`content_type = "${filter.contentType}"`);
  if (parts.length > 0) q = q.where(parts.join(' AND '));

  const rows = await q.toArray();

  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    text: r.text as string,
    source_tab: r.source_tab as string,
    content_type: r.content_type as string,
    tags: r.tags as string,
    score: r._distance !== undefined ? 1 - (r._distance as number) : 0,
  }));
}
