import { KnowledgeGraphManager } from '../KnowledgeGraphManager.js';
import { PDFDocumentProcessor } from './PDFDocumentProcessor.js';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Demo script showing PDF document processing into vector store and knowledge graph
 * 
 * This demo uses the test instance running at:
 * - API: http://localhost:3100
 * - Neo4j: http://localhost:3101
 * - PostgreSQL: localhost:3103
 */

const TEST_INSTANCE_CONFIG = {
    apiEndpoint: 'http://localhost:3100',
    apiKey: 'd60003ed6f628d3dfbf9b37b5303e5fe35161ec21828a3541685692041d06438',
    neo4jUri: 'bolt://localhost:3102',
    neo4jUsername: 'neo4j',
    neo4jPassword: '0bd57834fc23f3a45115f528089cbd33',
    postgresHost: 'localhost',
    postgresPort: 3103,
    postgresDatabase: 'memento_test-instance',
    postgresUsername: 'memento_user',
    postgresPassword: 'f47e85e8e8f5350e3e3a10c02500dbbf'
};

/**
 * Create sample documents for testing PDF processing
 */
async function createSampleDocuments(): Promise<string[]> {
    const documentsDir = path.join(process.cwd(), 'test-documents');
    
    // Ensure directory exists
    try {
        await fs.mkdir(documentsDir, { recursive: true });
    } catch (error) {
        // Directory might already exist
    }

    const sampleDocuments = [
        {
            filename: 'ai-research-paper.txt',
            content: `
Artificial Intelligence and Machine Learning: A Comprehensive Overview

Abstract
This paper provides a comprehensive overview of artificial intelligence and machine learning technologies. We explore the fundamental concepts, applications, and future directions of AI research.

Introduction
Artificial Intelligence (AI) has emerged as one of the most transformative technologies of the 21st century. Machine Learning, a subset of AI, enables computers to learn and improve from experience without being explicitly programmed.

Key Concepts
1. Neural Networks: Computational models inspired by biological neural networks
2. Deep Learning: Multi-layered neural networks capable of complex pattern recognition
3. Natural Language Processing: AI techniques for understanding and generating human language
4. Computer Vision: AI systems that can interpret and understand visual information

Applications
- Healthcare: Diagnostic systems, drug discovery, personalized medicine
- Finance: Fraud detection, algorithmic trading, risk assessment
- Transportation: Autonomous vehicles, traffic optimization, predictive maintenance
- Education: Personalized learning, intelligent tutoring systems, automated grading

Future Directions
The future of AI includes developments in:
- Explainable AI: Making AI decisions more transparent and interpretable
- Edge Computing: Running AI models on local devices rather than cloud servers
- Quantum Machine Learning: Leveraging quantum computing for AI applications
- Ethical AI: Ensuring AI systems are fair, unbiased, and beneficial to society

Conclusion
Artificial Intelligence and Machine Learning continue to evolve rapidly, offering unprecedented opportunities to solve complex problems and enhance human capabilities. However, careful consideration of ethical implications and societal impact remains crucial.

References
1. Russell, S. & Norvig, P. Artificial Intelligence: A Modern Approach
2. Goodfellow, I., Bengio, Y. & Courville, A. Deep Learning
3. Mitchell, T. Machine Learning
            `.trim()
        },
        {
            filename: 'blockchain-technology.txt',
            content: `
Blockchain Technology: Principles and Applications

Abstract
This document explores blockchain technology, its underlying principles, and various applications across different industries. We examine the potential benefits and challenges of blockchain adoption.

Introduction
Blockchain is a distributed ledger technology that maintains a continuously growing list of records, called blocks, which are linked and secured using cryptography. Originally developed for Bitcoin, blockchain has found applications far beyond cryptocurrency.

Core Principles
1. Decentralization: No single point of control or failure
2. Transparency: All transactions are visible to network participants
3. Immutability: Once recorded, data cannot be easily altered or deleted
4. Consensus: Network agreement on the validity of transactions
5. Cryptographic Security: Advanced encryption protects data integrity

Technical Components
- Hash Functions: Mathematical algorithms that create unique fingerprints for data
- Digital Signatures: Cryptographic mechanisms for verifying authenticity
- Merkle Trees: Binary tree structures for efficient data verification
- Consensus Algorithms: Methods for achieving network agreement (Proof of Work, Proof of Stake)

Applications
Supply Chain Management
- Track products from origin to consumer
- Verify authenticity and prevent counterfeiting
- Improve transparency and accountability

Financial Services
- Cross-border payments and remittances
- Trade finance and letters of credit
- Insurance claim processing

Healthcare
- Secure patient record management
- Drug traceability and anti-counterfeiting
- Clinical trial data integrity

Digital Identity
- Self-sovereign identity solutions
- Academic credential verification
- Professional certification tracking

Challenges and Limitations
- Scalability: Current blockchain networks have limited transaction throughput
- Energy Consumption: Some consensus mechanisms require significant computational power
- Regulatory Uncertainty: Evolving legal frameworks across jurisdictions
- Technical Complexity: Implementation and maintenance challenges
- User Adoption: Need for better user interfaces and education

Future Outlook
Blockchain technology continues to mature with developments in:
- Layer 2 scaling solutions
- Interoperability protocols
- Central Bank Digital Currencies (CBDCs)
- Integration with IoT and AI technologies
- Sustainability improvements

Conclusion
Blockchain technology offers significant potential for creating more transparent, secure, and efficient systems across various industries. While challenges remain, ongoing research and development continue to address limitations and expand possible applications.
            `.trim()
        },
        {
            filename: 'climate-change-report.txt',
            content: `
Climate Change and Environmental Impact: A Global Assessment

Executive Summary
This report examines the current state of climate change, its environmental impacts, and potential mitigation strategies. The analysis draws from scientific research and global environmental data to present a comprehensive overview of climate challenges and solutions.

Climate Change Overview
Climate change refers to long-term shifts in global or regional climate patterns, primarily attributed to human activities since the mid-20th century. The primary driver is increased greenhouse gas emissions from burning fossil fuels.

Key Environmental Indicators
1. Global Temperature Rise: Average global temperatures have increased by approximately 1.1°C since pre-industrial times
2. Sea Level Rise: Global sea levels have risen by about 20cm since 1900
3. Arctic Ice Loss: Arctic sea ice is declining at a rate of 13% per decade
4. Extreme Weather Events: Increased frequency and intensity of hurricanes, droughts, and heat waves

Greenhouse Gas Emissions
Primary Sources:
- Energy Production: Coal, oil, and natural gas combustion (75% of emissions)
- Agriculture: Livestock, rice cultivation, and fertilizer use (18% of emissions)
- Industrial Processes: Manufacturing, cement production, chemical processes (5% of emissions)
- Deforestation: Loss of carbon-absorbing forests (2% of emissions)

Environmental Impacts
Ecosystem Disruption
- Coral reef bleaching and marine ecosystem damage
- Forest degradation and biodiversity loss
- Disruption of migration patterns
- Changes in plant and animal habitats

Water Resources
- Altered precipitation patterns
- Increased frequency of droughts and floods
- Glacier and snowpack melting
- Groundwater depletion

Agriculture and Food Security
- Reduced crop yields in many regions
- Increased pest and disease pressure
- Soil degradation and erosion
- Threats to food supply chains

Human Health Impacts
- Heat-related illnesses and deaths
- Vector-borne disease expansion
- Air quality deterioration
- Food and water security threats

Mitigation Strategies
Renewable Energy Transition
- Solar and wind power expansion
- Energy storage technology development
- Smart grid implementation
- Electric vehicle adoption

Carbon Capture and Storage
- Industrial carbon capture technologies
- Natural carbon sequestration through reforestation
- Direct air capture systems
- Soil carbon enhancement

Policy Measures
- Carbon pricing and emissions trading
- Renewable energy subsidies
- Building efficiency standards
- Transportation electrification mandates

International Cooperation
- Paris Climate Agreement implementation
- Technology transfer to developing countries
- Climate finance mechanisms
- Global emissions monitoring

Adaptation Measures
Infrastructure Resilience
- Climate-resilient building codes
- Flood protection systems
- Drought-resistant water management
- Extreme weather early warning systems

Ecosystem Conservation
- Protected area expansion
- Habitat restoration projects
- Sustainable forestry practices
- Marine conservation efforts

Conclusion and Recommendations
Addressing climate change requires urgent, coordinated global action across multiple sectors. Key priorities include:
1. Rapid decarbonization of energy systems
2. Protection and restoration of natural ecosystems
3. Development and deployment of clean technologies
4. Enhanced international cooperation and climate finance
5. Building climate resilience in vulnerable communities

The window for limiting global warming to 1.5°C is rapidly closing, making immediate action essential for avoiding the most severe climate impacts.
            `.trim()
        }
    ];

    const filePaths: string[] = [];
    for (const doc of sampleDocuments) {
        const filePath = path.join(documentsDir, doc.filename);
        await fs.writeFile(filePath, doc.content, 'utf-8');
        filePaths.push(filePath);
        console.log(`Created sample document: ${filePath}`);
    }

    return filePaths;
}

/**
 * Test API connectivity to the running instance
 */
async function testAPIConnectivity(): Promise<boolean> {
    try {
        const response = await fetch(`${TEST_INSTANCE_CONFIG.apiEndpoint}/health`, {
            method: 'GET',
            headers: {
                'X-API-Key': TEST_INSTANCE_CONFIG.apiKey,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const healthData = await response.json();
            console.log('✅ API connectivity test passed');
            console.log('Health status:', healthData);
            return true;
        } else {
            console.error('❌ API connectivity test failed:', response.status, response.statusText);
            return false;
        }
    } catch (error) {
        console.error('❌ API connectivity test failed:', error);
        return false;
    }
}

/**
 * Create a REST API client for interacting with the knowledge graph
 */
class RestAPIKnowledgeGraphClient {
    private apiEndpoint: string;
    private apiKey: string;

    constructor(apiEndpoint: string, apiKey: string) {
        this.apiEndpoint = apiEndpoint;
        this.apiKey = apiKey;
    }

    async createEntities(entities: any[]): Promise<any[]> {
        const response = await fetch(`${this.apiEndpoint}/api/v1/entities`, {
            method: 'POST',
            headers: {
                'X-API-Key': this.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ entities })
        });

        if (!response.ok) {
            throw new Error(`Failed to create entities: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        return Array.isArray(result) ? result : [result];
    }

    async createRelations(relations: any[]): Promise<any[]> {
        const response = await fetch(`${this.apiEndpoint}/api/v1/relations`, {
            method: 'POST',
            headers: {
                'X-API-Key': this.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ relations })
        });

        if (!response.ok) {
            throw new Error(`Failed to create relations: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        return Array.isArray(result) ? result : [result];
    }

    async searchNodes(query: string): Promise<any> {
        const response = await fetch(`${this.apiEndpoint}/api/v1/search?query=${encodeURIComponent(query)}`, {
            method: 'GET',
            headers: {
                'X-API-Key': this.apiKey,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to search nodes: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    async openNodes(names: string[]): Promise<any> {
        const response = await fetch(`${this.apiEndpoint}/api/v1/entities`, {
            method: 'POST',
            headers: {
                'X-API-Key': this.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ names })
        });

        if (!response.ok) {
            throw new Error(`Failed to open nodes: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    async semanticSearch(query: string, options: any = {}): Promise<any> {
        const response = await fetch(`${this.apiEndpoint}/api/v1/search/semantic`, {
            method: 'POST',
            headers: {
                'X-API-Key': this.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query, ...options })
        });

        if (!response.ok) {
            throw new Error(`Failed to perform semantic search: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }
}

/**
 * Create a mock KnowledgeGraphManager that uses REST API
 */
class APIKnowledgeGraphManager {
    private client: RestAPIKnowledgeGraphClient;

    constructor(apiEndpoint: string, apiKey: string) {
        this.client = new RestAPIKnowledgeGraphClient(apiEndpoint, apiKey);
    }

    async createEntities(entities: any[]): Promise<any[]> {
        return await this.client.createEntities(entities);
    }

    async createRelations(relations: any[]): Promise<any[]> {
        return await this.client.createRelations(relations);
    }

    async searchNodes(query: string): Promise<any> {
        return await this.client.searchNodes(query);
    }

    async openNodes(names: string[]): Promise<any> {
        return await this.client.openNodes(names);
    }

    async search(query: string, options: any = {}): Promise<any> {
        if (options.semanticSearch || options.hybridSearch) {
            return await this.client.semanticSearch(query, options);
        } else {
            return await this.client.searchNodes(query);
        }
    }
}

/**
 * Main demonstration function
 */
async function runPDFProcessingDemo(): Promise<void> {
    console.log('🚀 Starting PDF Document Processing Demo');
    console.log('==========================================');

    // Step 1: Test API connectivity
    console.log('\n📡 Testing API connectivity...');
    const isConnected = await testAPIConnectivity();
    if (!isConnected) {
        console.error('Failed to connect to API. Please ensure the test instance is running.');
        process.exit(1);
    }

    // Step 2: Create sample documents
    console.log('\n📄 Creating sample documents...');
    const documentPaths = await createSampleDocuments();

    // Step 3: Initialize PDF processor with API-based knowledge graph manager
    console.log('\n🔧 Initializing PDF processor...');
    const knowledgeGraph = new APIKnowledgeGraphManager(
        TEST_INSTANCE_CONFIG.apiEndpoint,
        TEST_INSTANCE_CONFIG.apiKey
    ) as any; // Type assertion for compatibility

    const pdfProcessor = new PDFDocumentProcessor(knowledgeGraph, {
        maxChunkSize: 500, // Smaller chunks for demo
        chunkOverlap: 100,
        apiEndpoint: TEST_INSTANCE_CONFIG.apiEndpoint,
        apiKey: TEST_INSTANCE_CONFIG.apiKey
    });

    // Step 4: Process each document
    console.log('\n📊 Processing documents...');
    const processedDocuments = [];

    for (const docPath of documentPaths) {
        console.log(`\nProcessing: ${path.basename(docPath)}`);
        try {
            const result = await pdfProcessor.processPDFDocument(docPath, {
                extractEntities: true,
                createGraphRelationships: true
            });

            processedDocuments.push(result);
            console.log(`✅ Processed ${result.title}:`);
            console.log(`   - Document ID: ${result.documentId}`);
            console.log(`   - Pages: ${result.pages}`);
            console.log(`   - Word count: ${result.wordCount}`);
            console.log(`   - Chunks: ${result.chunks.length}`);
            console.log(`   - Extracted entities: ${result.extractedEntities.length}`);
            console.log(`   - Relationships: ${result.relationships.length}`);
        } catch (error) {
            console.error(`❌ Failed to process ${docPath}:`, error);
        }
    }

    // Step 5: Demonstrate search functionality
    console.log('\n🔍 Testing search functionality...');

    const searchQueries = [
        'artificial intelligence machine learning',
        'blockchain cryptocurrency',
        'climate change environmental',
        'neural networks deep learning'
    ];

    for (const query of searchQueries) {
        console.log(`\nSearching for: "${query}"`);
        try {
            // Test basic search
            const basicResults = await pdfProcessor.searchSimilarContent(query, {
                limit: 5,
                threshold: 0.5
            });

            console.log(`📋 Basic search results: ${basicResults.entities?.length || 0} entities found`);
            
            if (basicResults.entities && basicResults.entities.length > 0) {
                basicResults.entities.slice(0, 3).forEach((entity: any, index: number) => {
                    console.log(`   ${index + 1}. ${entity.name} (${entity.entityType})`);
                });
            }

        } catch (error) {
            console.error(`❌ Search failed for "${query}":`, error);
        }
    }

    // Step 6: Demonstrate document graph relationships
    console.log('\n🕸️  Testing document graph relationships...');

    for (const doc of processedDocuments.slice(0, 2)) { // Test first 2 documents
        console.log(`\nAnalyzing document: ${doc.title}`);
        try {
            const documentGraph = await pdfProcessor.getDocumentGraph(doc.documentId);
            
            console.log(`📊 Document graph for ${doc.documentId}:`);
            console.log(`   - Main entity: ${documentGraph.document?.name || 'Not found'}`);
            console.log(`   - Related content: ${documentGraph.relatedContent?.entities?.length || 0} entities`);
            
            if (documentGraph.relatedContent?.relations) {
                console.log(`   - Relations: ${documentGraph.relatedContent.relations.length}`);
            }

        } catch (error) {
            console.error(`❌ Failed to get document graph for ${doc.documentId}:`, error);
        }
    }

    // Step 7: Summary
    console.log('\n📈 Demo Summary');
    console.log('===============');
    console.log(`✅ Created ${documentPaths.length} sample documents`);
    console.log(`✅ Processed ${processedDocuments.length} documents successfully`);
    
    const totalChunks = processedDocuments.reduce((sum, doc) => sum + doc.chunks.length, 0);
    const totalEntities = processedDocuments.reduce((sum, doc) => sum + doc.extractedEntities.length, 0);
    const totalRelationships = processedDocuments.reduce((sum, doc) => sum + doc.relationships.length, 0);
    
    console.log(`✅ Generated ${totalChunks} text chunks`);
    console.log(`✅ Extracted ${totalEntities} entities`);
    console.log(`✅ Created ${totalRelationships} relationships`);
    console.log(`✅ All data stored in both vector store (PostgreSQL) and graph database (Neo4j)`);
    
    console.log('\n🎉 PDF Document Processing Demo Completed Successfully!');
    console.log('\nYou can now:');
    console.log('- View the Neo4j browser at http://localhost:3101');
    console.log('- Query the API directly at http://localhost:3100');
    console.log('- Use semantic search to find related content');
    console.log('- Explore document relationships in the graph');
}

// Run the demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runPDFProcessingDemo().catch((error) => {
        console.error('Demo failed:', error);
        process.exit(1);
    });
}

export { runPDFProcessingDemo, createSampleDocuments, testAPIConnectivity };
