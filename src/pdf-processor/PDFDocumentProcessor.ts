import { KnowledgeGraphManager, Entity, Relation } from '../KnowledgeGraphManager.js';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

// PDF processing library - will need to be installed
// Note: pdf-parse needs to be installed via: npm install pdf-parse
// import * as pdfParse from 'pdf-parse';

export interface DocumentChunk {
    id: string;
    content: string;
    pageNumber: number;
    chunkIndex: number;
    startOffset: number;
    endOffset: number;
    metadata: {
        documentId: string;
        documentTitle: string;
        chunkType: 'text' | 'heading' | 'paragraph' | 'list_item';
        confidence: number;
    };
}

export interface DocumentStructure {
    documentId: string;
    title: string;
    pages: number;
    wordCount: number;
    chunks: DocumentChunk[];
    extractedEntities: string[];
    relationships: Array<{
        from: string;
        to: string;
        type: string;
        confidence: number;
    }>;
}

export class PDFDocumentProcessor {
    protected knowledgeGraph: KnowledgeGraphManager;
    protected maxChunkSize: number;
    protected chunkOverlap: number;
    protected apiEndpoint: string;
    protected apiKey: string;

    constructor(
        knowledgeGraph: KnowledgeGraphManager,
        options: {
            maxChunkSize?: number;
            chunkOverlap?: number;
            apiEndpoint: string;
            apiKey: string;
        }
    ) {
        this.knowledgeGraph = knowledgeGraph;
        this.maxChunkSize = options.maxChunkSize || 1000;
        this.chunkOverlap = options.chunkOverlap || 200;
        this.apiEndpoint = options.apiEndpoint;
        this.apiKey = options.apiKey;
    }

    /**
     * Process a PDF document into both vector store and knowledge graph
     */
    async processPDFDocument(
        filePath: string,
        options?: {
            documentTitle?: string;
            extractEntities?: boolean;
            createGraphRelationships?: boolean;
        }
    ): Promise<DocumentStructure> {
        try {
            console.log(`Starting PDF processing: ${filePath}`);
            
            // Step 1: Extract text from PDF
            const pdfBuffer = fs.readFileSync(filePath);
            
            // For now, we'll simulate PDF parsing until pdf-parse is installed
            // TODO: Install pdf-parse package and uncomment the line below
            // const pdfData = await pdfParse(pdfBuffer);
            
            // Temporary simulation - replace with actual PDF parsing
            const pdfData = {
                text: `Sample PDF content for ${path.basename(filePath)}. This would be extracted from the actual PDF file.`,
                numpages: 1
            };
            
            const documentId = this.generateDocumentId(filePath);
            const documentTitle = options?.documentTitle || path.basename(filePath, '.pdf');
            
            console.log(`Extracted ${pdfData.text.length} characters from ${pdfData.numpages} pages`);

            // Step 2: Create document chunks
            const chunks = await this.createTextChunks(
                pdfData.text,
                documentId,
                documentTitle,
                pdfData.numpages
            );

            console.log(`Created ${chunks.length} text chunks`);

            // Step 3: Create document entity in knowledge graph
            await this.createDocumentEntity(documentId, documentTitle, pdfData, chunks.length);

            // Step 4: Process chunks into vector store and graph
            await this.processChunksIntoGraph(chunks);

            // Step 5: Extract entities and relationships (optional)
            const extractedEntities: string[] = [];
            const relationships: Array<{from: string, to: string, type: string, confidence: number}> = [];
            
            if (options?.extractEntities) {
                const entityData = await this.extractEntitiesFromContent(pdfData.text, documentId);
                extractedEntities.push(...entityData.entities);
                relationships.push(...entityData.relationships);
            }

            // Step 6: Create graph relationships
            if (options?.createGraphRelationships) {
                await this.createDocumentRelationships(documentId, chunks, relationships);
            }

            const structure: DocumentStructure = {
                documentId,
                title: documentTitle,
                pages: pdfData.numpages,
                wordCount: pdfData.text.split(/\s+/).length,
                chunks,
                extractedEntities,
                relationships
            };

            console.log(`PDF processing completed for: ${documentTitle}`);
            return structure;

        } catch (error) {
            console.error('PDF processing error:', error);
            throw error;
        }
    }

    /**
     * Generate unique document ID based on file path and content
     */
    private generateDocumentId(filePath: string): string {
        const hash = createHash('md5').update(filePath + Date.now()).digest('hex');
        return `doc_${hash.substring(0, 12)}`;
    }

    /**
     * Create text chunks from PDF content
     */
    protected async createTextChunks(
        text: string,
        documentId: string,
        documentTitle: string,
        pageCount: number
    ): Promise<DocumentChunk[]> {
        const chunks: DocumentChunk[] = [];
        
        // Simple chunking strategy - can be enhanced with more sophisticated methods
        const sentences = text.split(/(?<=[.!?])\s+/);
        let currentChunk = '';
        let chunkIndex = 0;
        let currentOffset = 0;

        for (const sentence of sentences) {
            if (currentChunk.length + sentence.length > this.maxChunkSize) {
                if (currentChunk.length > 0) {
                    chunks.push({
                        id: `${documentId}_chunk_${chunkIndex}`,
                        content: currentChunk.trim(),
                        pageNumber: Math.ceil((currentOffset / text.length) * pageCount),
                        chunkIndex,
                        startOffset: currentOffset - currentChunk.length,
                        endOffset: currentOffset,
                        metadata: {
                            documentId,
                            documentTitle,
                            chunkType: this.determineChunkType(currentChunk),
                            confidence: 0.8
                        }
                    });
                    chunkIndex++;
                }
                currentChunk = sentence;
            } else {
                currentChunk += (currentChunk ? ' ' : '') + sentence;
            }
            currentOffset += sentence.length + 1;
        }

        // Add final chunk
        if (currentChunk.length > 0) {
            chunks.push({
                id: `${documentId}_chunk_${chunkIndex}`,
                content: currentChunk.trim(),
                pageNumber: Math.ceil((currentOffset / text.length) * pageCount),
                chunkIndex,
                startOffset: currentOffset - currentChunk.length,
                endOffset: currentOffset,
                metadata: {
                    documentId,
                    documentTitle,
                    chunkType: this.determineChunkType(currentChunk),
                    confidence: 0.8
                }
            });
        }

        return chunks;
    }

    /**
     * Determine the type of content chunk
     */
    private determineChunkType(content: string): 'text' | 'heading' | 'paragraph' | 'list_item' {
        // Simple heuristics - can be enhanced with NLP
        if (content.length < 100 && /^[A-Z]/.test(content) && !/[.!?]$/.test(content)) {
            return 'heading';
        }
        if (/^\s*[-*•]\s/.test(content)) {
            return 'list_item';
        }
        if (content.length > 200) {
            return 'paragraph';
        }
        return 'text';
    }

    /**
     * Create the main document entity in the knowledge graph
     */
    private async createDocumentEntity(
        documentId: string,
        title: string,
        pdfData: any,
        chunkCount: number
    ): Promise<void> {
        const documentEntity: Entity = {
            name: documentId,
            entityType: 'document',
            observations: [
                `Title: ${title}`,
                `Pages: ${pdfData.numpages}`,
                `Word count: ${pdfData.text.split(/\s+/).length}`,
                `Chunks created: ${chunkCount}`,
                `Processing date: ${new Date().toISOString()}`,
                `File type: PDF`
            ]
        };

        await this.knowledgeGraph.createEntities([documentEntity]);
        console.log(`Created document entity: ${documentId}`);
    }

    /**
     * Process chunks into both vector store and knowledge graph
     */
    protected async processChunksIntoGraph(chunks: DocumentChunk[]): Promise<void> {
        // Create chunk entities for the knowledge graph
        const chunkEntities: Entity[] = chunks.map(chunk => ({
            name: chunk.id,
            entityType: 'document_chunk',
            observations: [
                `Content: ${chunk.content.substring(0, 200)}${chunk.content.length > 200 ? '...' : ''}`,
                `Page: ${chunk.pageNumber}`,
                `Chunk type: ${chunk.metadata.chunkType}`,
                `Word count: ${chunk.content.split(/\s+/).length}`,
                `Document: ${chunk.metadata.documentId}`
            ]
        }));

        // Create entities in the knowledge graph (this will also create embeddings)
        await this.knowledgeGraph.createEntities(chunkEntities);

        // Create relationships between document and chunks
        const chunkRelations: Relation[] = chunks.map(chunk => ({
            from: chunk.metadata.documentId,
            to: chunk.id,
            relationType: 'contains_chunk'
        }));

        await this.knowledgeGraph.createRelations(chunkRelations);
        console.log(`Processed ${chunks.length} chunks into graph and vector store`);
    }

    /**
     * Extract entities from content using simple NLP techniques
     */
    private async extractEntitiesFromContent(
        text: string,
        documentId: string
    ): Promise<{entities: string[], relationships: Array<{from: string, to: string, type: string, confidence: number}>}> {
        // Simple entity extraction - can be enhanced with NLP libraries
        const entities: string[] = [];
        const relationships: Array<{from: string, to: string, type: string, confidence: number}> = [];

        // Extract potential entities (capitalized words, phrases)
        const potentialEntities = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [];
        const uniqueEntities = [...new Set(potentialEntities)]
            .filter(entity => entity.length > 2 && entity.length < 50)
            .slice(0, 50); // Limit to 50 entities

        for (const entityName of uniqueEntities) {
            entities.push(entityName);
            relationships.push({
                from: documentId,
                to: `entity_${entityName.toLowerCase().replace(/\s+/g, '_')}`,
                type: 'mentions',
                confidence: 0.6
            });
        }

        // Create entity objects in the knowledge graph
        if (entities.length > 0) {
            const entityObjects: Entity[] = entities.map(name => ({
                name: `entity_${name.toLowerCase().replace(/\s+/g, '_')}`,
                entityType: 'extracted_entity',
                observations: [
                    `Original text: ${name}`,
                    `Extracted from document: ${documentId}`,
                    `Extraction confidence: 0.6`
                ]
            }));

            await this.knowledgeGraph.createEntities(entityObjects);
        }

        return { entities, relationships };
    }

    /**
     * Create relationships between document components
     */
    private async createDocumentRelationships(
        documentId: string,
        chunks: DocumentChunk[],
        extractedRelationships: Array<{from: string, to: string, type: string, confidence: number}>
    ): Promise<void> {
        const relations: Relation[] = [];

        // Create sequential relationships between chunks
        for (let i = 0; i < chunks.length - 1; i++) {
            relations.push({
                from: chunks[i].id,
                to: chunks[i + 1].id,
                relationType: 'followed_by'
            });
        }

        // Add extracted entity relationships
        for (const rel of extractedRelationships) {
            relations.push({
                from: rel.from,
                to: rel.to,
                relationType: rel.type
            });
        }

        if (relations.length > 0) {
            await this.knowledgeGraph.createRelations(relations);
            console.log(`Created ${relations.length} document relationships`);
        }
    }

    /**
     * Search for similar content using vector similarity
     */
    async searchSimilarContent(
        query: string,
        options?: {
            limit?: number;
            threshold?: number;
            documentFilter?: string;
        }
    ): Promise<any> {
        return await this.knowledgeGraph.search(query, {
            limit: options?.limit || 10,
            threshold: options?.threshold || 0.7,
            entityTypes: ['document_chunk', 'document'],
            hybridSearch: true,
            semanticSearch: true
        });
    }

    /**
     * Get document structure and relationships
     */
    async getDocumentGraph(documentId: string): Promise<any> {
        // Get document entity and all related chunks
        const document = await this.knowledgeGraph.openNodes([documentId]);
        const searchResults = await this.knowledgeGraph.searchNodes(documentId);
        
        return {
            document: document.entities?.[0],
            relatedContent: searchResults
        };
    }
}
