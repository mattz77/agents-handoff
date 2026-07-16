import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

// Lazy-load: o binário nativo do LanceDB pode falhar na plataforma (ex.: musl build com
// símbolo AVX512 não resolvido no Alpine). RAG indisponível não pode derrubar o daemon.
type LanceDb = typeof import('@lancedb/lancedb');
let lancedbModule: LanceDb | null | undefined;
function getLancedb(): LanceDb | null {
    if (lancedbModule !== undefined) return lancedbModule;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        lancedbModule = require('@lancedb/lancedb') as LanceDb;
    } catch (err) {
        console.error('[RAG] LanceDB indisponível nesta plataforma — busca vetorial desabilitada:', (err as Error).message.split('\n')[0]);
        lancedbModule = null;
    }
    return lancedbModule;
}

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIM = 3072;

export interface RAGContext {
    relevantDocs: Array<{
        title: string;
        content: string;
        score: number;
        filePath: string;
    }>;
    summary: string;
}

export interface DocChunk {
    filePath: string;
    heading: string;
    content: string;
}

// Divide um doc markdown por seções "## ", com max ~1500 chars por chunk.
export function chunkMarkdown(filePath: string, raw: string): DocChunk[] {
    const lines = raw.split(/\r?\n/);
    const chunks: DocChunk[] = [];
    let currentHeading = path.basename(filePath);
    let buf: string[] = [];

    const flush = () => {
        if (buf.length === 0) return;
        let text = buf.join('\n').trim();
        if (!text) { buf = []; return; }
        while (text.length > 0) {
            const slice = text.slice(0, 1500);
            chunks.push({ filePath, heading: currentHeading, content: slice });
            text = text.slice(1500);
        }
        buf = [];
    };

    for (const line of lines) {
        if (/^##\s+/.test(line)) {
            flush();
            currentHeading = line.replace(/^##\s+/, '').trim();
        }
        buf.push(line);
    }
    flush();
    return chunks;
}

export class DataLakeRAGService {
    private readonly datalakePath: string;
    private readonly vectorStorePath: string;
    private readonly ai: GoogleGenAI | null;

    constructor(datalakeMount: string = process.env.WATCHER_DATALAKE_KB_DIR?.replace('/Knowledge_Base', '') ?? '/data/datalake') {
        this.datalakePath = datalakeMount;
        // VectorStore NUNCA sob o mount do Google Drive (é :ro em produção e frágil p/ versionamento LanceDB
        // com sync de cloud storage) — usa RAG_VECTORSTORE_DIR (volume Docker writable) ou fallback local.
        this.vectorStorePath = process.env.RAG_VECTORSTORE_DIR
            ?? path.join(__dirname, '..', '..', '.data', 'vectorstore');

        const apiKey = process.env.GEMINI_API_KEY;
        this.ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
        if (!this.ai) {
            console.warn('[RAG] GEMINI_API_KEY ausente — embeddings desabilitados (fallback determinístico).');
        }

        if (!fs.existsSync(this.vectorStorePath)) {
            try {
                fs.mkdirSync(this.vectorStorePath, { recursive: true });
            } catch (err) {
                console.warn('[RAG] Aviso: Não foi possível criar pasta Vetorial no DataLake. Está montado?', err);
            }
        }
    }

    private async generateEmbedding(text: string, attempt = 0): Promise<number[]> {
        if (!this.ai) {
            // Fallback determinístico (sem key) — não é semântico, só evita crash.
            return Array(EMBEDDING_DIM).fill(0);
        }
        try {
            const r = await this.ai.models.embedContent({ model: EMBEDDING_MODEL, contents: text.slice(0, 8000) });
            return r.embeddings![0].values as number[];
        } catch (err: any) {
            const is429 = err?.status === 429 || /RESOURCE_EXHAUSTED/.test(String(err?.message ?? err));
            if (is429 && attempt < 5) {
                const waitMs = 15000 * (attempt + 1);
                console.warn(`[RAG] Rate limit (429), aguardando ${waitMs}ms antes de retry (tentativa ${attempt + 1}/5)...`);
                await new Promise((r) => setTimeout(r, waitMs));
                return this.generateEmbedding(text, attempt + 1);
            }
            throw err;
        }
    }

    // Remove todos os chunks de um arquivo antes de reindexar — sem isso, cada save do
    // mesmo arquivo (watcher live) ou cada restart do daemon (index inicial) acumula
    // chunks duplicados/obsoletos e degrada a busca semântica.
    private async deleteDocument(filePath: string): Promise<void> {
        const lancedb = getLancedb();
        if (!lancedb) return;
        try {
            const db = await lancedb.connect(this.vectorStorePath);
            const tableNames = await db.tableNames();
            if (!tableNames.includes('knowledge_base')) return;
            const table = await db.openTable('knowledge_base');
            const escaped = filePath.replace(/'/g, "''");
            await table.delete(`filePath = '${escaped}'`);
        } catch (err) {
            console.error('[RAG] Falha ao remover chunks antigos:', err);
        }
    }

    public async indexDocument(filePath: string, content: string): Promise<boolean> {
        console.log(`[RAG] Indexando arquivo no DataLake LanceDB: ${filePath}`);

        try {
            const lancedb = getLancedb();
            if (!lancedb) return false;
            const db = await lancedb.connect(this.vectorStorePath);
            const chunks = chunkMarkdown(filePath, content);
            await this.deleteDocument(filePath); // idempotente: upsert por arquivo (delete + insert)
            if (chunks.length === 0) return true;

            const data = [];
            for (const chunk of chunks) {
                const embedding = await this.generateEmbedding(`${chunk.heading}\n${chunk.content}`);
                await new Promise((r) => setTimeout(r, 400)); // throttle proativo (free tier ~100 req/min)
                data.push({
                    vector: embedding,
                    filePath: chunk.filePath,
                    content: chunk.content,
                    title: chunk.heading,
                });
            }

            const tableNames = await db.tableNames();
            if (tableNames.includes('knowledge_base')) {
                const table = await db.openTable('knowledge_base');
                await table.add(data);
            } else {
                await db.createTable('knowledge_base', data);
            }
            return true;
        } catch (err) {
            console.error('[RAG] Falha ao indexar documento no LanceDB:', err);
            return false;
        }
    }

    // Dropa e recria a tabela do zero — usado pra descartar os embeddings mock (Math.random).
    public async reindexAll(files: Array<{ filePath: string; content: string }>): Promise<{ indexed: number; failed: number }> {
        const lancedb = getLancedb();
        if (!lancedb) return { indexed: 0, failed: files.length };
        const db = await lancedb.connect(this.vectorStorePath);
        const tableNames = await db.tableNames();
        if (tableNames.includes('knowledge_base')) {
            await db.dropTable('knowledge_base');
        }
        let indexed = 0;
        let failed = 0;
        for (const f of files) {
            const ok = await this.indexDocument(f.filePath, f.content);
            if (ok) indexed++; else failed++;
        }
        return { indexed, failed };
    }

    public async retrieveContextForTask(taskDescription: string, maxResults: number = 3): Promise<RAGContext> {
        console.log(`[RAG] Realizando busca semântica no LanceDB (DataLake) para: ${taskDescription.substring(0, 30)}...`);
        
        try {
            const lancedb = getLancedb();
            if (!lancedb) return { relevantDocs: [], summary: "RAG vetorial indisponível nesta plataforma." };
            const db = await lancedb.connect(this.vectorStorePath);
            const tableNames = await db.tableNames();
            if (!tableNames.includes('knowledge_base')) {
                return { relevantDocs: [], summary: "Índice vazio." };
            }

            const table = await db.openTable('knowledge_base');
            const queryEmbedding = await this.generateEmbedding(taskDescription);
            
            const results = await table.search(queryEmbedding).limit(maxResults).toArray();
            
            const relevantDocs = results.map(r => ({
                title: r.title as string,
                content: (r.content as string).slice(0, 300),
                score: r._distance as number,
                filePath: r.filePath as string
            }));

            return {
                relevantDocs,
                summary: `Recuperados ${relevantDocs.length} documentos da base vetorial do DataLake.`
            };
        } catch (err) {
            console.error('[RAG] Falha na busca semântica do LanceDB:', err);
            return { relevantDocs: [], summary: "Erro interno no RAG." };
        }
    }
}

// Singleton compartilhado — server.ts (endpoint de busca) e rag-watcher.ts (ingestão) devem
// falar com a MESMA instância pra evitar clientes GoogleGenAI duplicados.
export const ragService = new DataLakeRAGService();
