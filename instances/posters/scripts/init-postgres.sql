-- Initialize PostgreSQL with pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Create embeddings table for poster analysis
CREATE TABLE IF NOT EXISTS embeddings (
    id SERIAL PRIMARY KEY,
    poster_id TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS embeddings_vector_idx ON embeddings
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
