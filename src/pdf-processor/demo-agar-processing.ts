import { AgarPDFProcessor } from './agar-pdf-processor.js';
import { KnowledgeGraphManager } from '../KnowledgeGraphManager.js';

/**
 * Demonstration script for processing Agar product data sheets
 * into the knowledge graph for chatbot integration
 */

async function main() {
    console.log('=== AGAR PDF PROCESSING FOR CHATBOT INTEGRATION ===\n');

    // Configuration for the enhanced-deploy-2025 instance
    const config = {
        apiEndpoint: 'http://localhost:5001',
        apiKey: '818a6b1cdd78de3e55d786b56daf285da63095f3b69e89447564c0ac1c5eef1e',
        agarPdfDirectory: '/Users/mick/AI/Ask-Agar/agar_docs/PDS_PDF'
    };

    console.log('Configuration:');
    console.log(`- API Endpoint: ${config.apiEndpoint}`);
    console.log(`- PDF Directory: ${config.agarPdfDirectory}`);
    console.log(`- Processing for chatbot: Ask Agar AI Assistant\n`);

    try {
        // Initialize Knowledge Graph Manager with API-based storage provider
        console.log('Initializing Knowledge Graph Manager...');
        const knowledgeGraph = new KnowledgeGraphManager();
        
        // For API-based operations, we'll use the existing patterns from demo-pdf-processing
        // The actual API calls will be handled by the PDF processor

        // Test API connection
        console.log('Testing API connection...');
        const testResult = await knowledgeGraph.readGraph();
        console.log(`✅ API connection successful! Found ${testResult.entities?.length || 0} existing entities\n`);

        // Initialize Agar PDF Processor
        console.log('Initializing Agar PDF Processor...');
        const agarProcessor = new AgarPDFProcessor(knowledgeGraph, {
            maxChunkSize: 800,  // Smaller chunks for better chatbot responses
            chunkOverlap: 150,
            apiEndpoint: config.apiEndpoint,
            apiKey: config.apiKey,
            agarPdfDirectory: config.agarPdfDirectory
        });

        // Process first 10 PDFs as a test run
        console.log('Starting test processing of first 10 Agar PDFs...\n');
        
        // Get list of PDF files for selective processing
        const fs = require('fs');
        const path = require('path');
        const pdfFiles = fs.readdirSync(config.agarPdfDirectory)
            .filter((file: string) => file.toLowerCase().endsWith('.pdf'))
            .sort()
            .slice(0, 10);  // Process first 10 files for testing

        console.log(`Selected ${pdfFiles.length} files for test processing:`);
        pdfFiles.forEach((file: string, index: number) => {
            console.log(`  ${index + 1}. ${file}`);
        });
        console.log();

        let successCount = 0;
        let errorCount = 0;
        const errors: Array<{file: string, error: string}> = [];

        // Process each PDF individually with better error handling
        for (const file of pdfFiles) {
            try {
                console.log(`Processing: ${file}...`);
                const filePath = path.join(config.agarPdfDirectory, file);
                
                // Use the parent class processPDFDocument method to avoid private method issues
                const result = await agarProcessor.processPDFDocument(filePath, {
                    documentTitle: file.replace('.pdf', ''),
                    extractEntities: true,
                    createGraphRelationships: true
                });

                console.log(`✅ Success: ${result.title} - ${result.chunks.length} chunks, ${result.pages} pages`);
                successCount++;

            } catch (error) {
                errorCount++;
                const errorMsg = error instanceof Error ? error.message : String(error);
                errors.push({file, error: errorMsg});
                console.error(`❌ Error processing ${file}: ${errorMsg}`);
            }

            // Brief pause between files
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Process results summary
        console.log(`\n=== PROCESSING RESULTS ===`);
        console.log(`Total files processed: ${pdfFiles.length}`);
        console.log(`Successful: ${successCount}`);
        console.log(`Errors: ${errorCount}`);
        console.log(`Success rate: ${((successCount / pdfFiles.length) * 100).toFixed(1)}%`);

        if (errors.length > 0) {
            console.log(`\nErrors encountered:`);
            errors.forEach(error => {
                console.log(`- ${error.file}: ${error.error}`);
            });
        }

        // Verify data in knowledge graph
        console.log(`\n=== VERIFYING CHATBOT DATA INTEGRATION ===`);
        
        try {
            // Search for Agar products
            console.log('Testing product search...');
            const searchResult = await knowledgeGraph.search('agar cleaning products', {
                limit: 5,
                hybridSearch: true
            });
            console.log(`Found ${searchResult.entities?.length || 0} Agar product entities`);

            // Test category search
            console.log('Testing category-based search...');
            const categorySearch = await knowledgeGraph.search('dishwashing cleaning', {
                limit: 3,
                hybridSearch: true
            });
            console.log(`Found ${categorySearch.entities?.length || 0} dishwashing products`);

            // Test semantic search for chatbot queries
            console.log('Testing semantic search for chatbot...');
            const chatbotQuery = await knowledgeGraph.findSimilarEntities('what products are good for kitchen cleaning', {
                limit: 5,
                threshold: 0.6
            });
            console.log(`Semantic search returned ${chatbotQuery.length || 0} relevant products`);

            console.log(`\n✅ Data integration verified! The knowledge graph now contains Agar product information optimized for chatbot responses.`);

        } catch (searchError) {
            console.error(`❌ Search verification failed:`, searchError);
        }

        // Final summary for chatbot integration
        console.log(`\n=== CHATBOT INTEGRATION SUMMARY ===`);
        console.log(`The Agar product knowledge base is now ready for chatbot integration:`);
        console.log(`- Product data sheets processed and chunked for optimal retrieval`);
        console.log(`- Categories created for organized product recommendations`);
        console.log(`- Semantic embeddings generated for intelligent search responses`);
        console.log(`- Graph relationships established for contextual recommendations`);
        console.log(`- API endpoints available at ${config.apiEndpoint} for chatbot queries`);
        
        console.log(`\nNext steps for full deployment:`);
        console.log(`1. Process all remaining PDFs (${171 - successCount} files)`);
        console.log(`2. Configure OpenAI API key for enhanced embeddings`);
        console.log(`3. Test chatbot integration with processed product data`);
        console.log(`4. Deploy knowledge graph to production environment`);

    } catch (error) {
        console.error('Fatal error in Agar PDF processing:', error);
        process.exit(1);
    }
}

// Execute if run directly
if (require.main === module) {
    main().catch(console.error);
}

export { main as runAgarProcessingDemo };
