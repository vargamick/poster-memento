import { PDFDocumentProcessor, DocumentStructure } from './PDFDocumentProcessor.js';
import { KnowledgeGraphManager, Entity, Relation } from '../KnowledgeGraphManager.js';
import * as fs from 'fs';
import * as path from 'path';
const pdfParse = require('pdf-parse');

export interface AgarProductData {
    productName: string;
    pdfPath: string;
    category: string;
    ingredients?: string[];
    usageInstructions?: string[];
    safetyInformation?: string[];
    applications?: string[];
    technicalSpecs?: Record<string, string>;
}

export class AgarPDFProcessor extends PDFDocumentProcessor {
    private agarPdfDirectory: string;
    private processedProducts: Map<string, AgarProductData> = new Map();

    constructor(
        knowledgeGraph: KnowledgeGraphManager,
        options: {
            maxChunkSize?: number;
            chunkOverlap?: number;
            apiEndpoint: string;
            apiKey: string;
            agarPdfDirectory: string;
        }
    ) {
        super(knowledgeGraph, options);
        this.agarPdfDirectory = options.agarPdfDirectory;
    }

    /**
     * Process all Agar PDF files in the directory
     */
    async processAllAgarPDFs(): Promise<{
        successCount: number;
        errorCount: number;
        totalFiles: number;
        processedProducts: AgarProductData[];
        errors: Array<{file: string, error: string}>;
    }> {
        console.log(`Starting Agar PDF processing from directory: ${this.agarPdfDirectory}`);
        
        const pdfFiles = fs.readdirSync(this.agarPdfDirectory)
            .filter(file => file.toLowerCase().endsWith('.pdf'))
            .sort();
        
        console.log(`Found ${pdfFiles.length} PDF files to process`);
        
        let successCount = 0;
        let errorCount = 0;
        const errors: Array<{file: string, error: string}> = [];
        
        // Process files in batches to avoid overwhelming the system
        const batchSize = 5;
        for (let i = 0; i < pdfFiles.length; i += batchSize) {
            const batch = pdfFiles.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(pdfFiles.length/batchSize)}: ${batch.join(', ')}`);
            
            const batchPromises = batch.map(async (file) => {
                try {
                    const filePath = path.join(this.agarPdfDirectory, file);
                    await this.processAgarPDF(filePath);
                    successCount++;
                    console.log(`✅ Successfully processed: ${file}`);
                } catch (error) {
                    errorCount++;
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    errors.push({file, error: errorMsg});
                    console.error(`❌ Error processing ${file}: ${errorMsg}`);
                }
            });
            
            await Promise.all(batchPromises);
            
            // Brief pause between batches
            if (i + batchSize < pdfFiles.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log(`\n=== AGAR PDF PROCESSING COMPLETE ===`);
        console.log(`Total files: ${pdfFiles.length}`);
        console.log(`Successful: ${successCount}`);
        console.log(`Errors: ${errorCount}`);
        console.log(`Success rate: ${((successCount / pdfFiles.length) * 100).toFixed(1)}%`);
        
        return {
            successCount,
            errorCount,
            totalFiles: pdfFiles.length,
            processedProducts: Array.from(this.processedProducts.values()),
            errors
        };
    }

    /**
     * Process a single Agar PDF with product-specific logic
     */
    async processAgarPDF(filePath: string): Promise<DocumentStructure> {
        try {
            // Extract text from actual PDF file
            const pdfBuffer = fs.readFileSync(filePath);
            const pdfData = await pdfParse(pdfBuffer);
            
            const productName = this.extractProductName(path.basename(filePath, '.pdf'));
            const documentId = `agar_product_${productName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
            
            console.log(`Processing Agar product: ${productName} (${pdfData.numpages} pages, ${pdfData.text.length} chars)`);
            
            // Extract product-specific information
            const productData = await this.extractAgarProductData(pdfData.text, productName, filePath);
            this.processedProducts.set(productName, productData);
            
            // Create product entity
            await this.createAgarProductEntity(documentId, productData, pdfData);
            
            // Create text chunks with product context
            const chunks = await this.createAgarProductChunks(
                pdfData.text,
                documentId,
                productName,
                pdfData.numpages,
                productData
            );
            
            // Process chunks into graph
            await this.processChunksIntoGraph(chunks);
            
            // Create Agar-specific relationships
            await this.createAgarProductRelationships(documentId, productData, chunks);
            
            return {
                documentId,
                title: productName,
                pages: pdfData.numpages,
                wordCount: pdfData.text.split(/\s+/).length,
                chunks,
                extractedEntities: this.extractAgarEntities(pdfData.text),
                relationships: []
            };
            
        } catch (error) {
            console.error(`Error processing ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Extract product name from filename
     */
    private extractProductName(filename: string): string {
        return filename
            .replace(/\.pdf$/i, '')
            .replace(/[_-]/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }

    /**
     * Extract Agar product-specific data from PDF text
     */
    private async extractAgarProductData(text: string, productName: string, filePath: string): Promise<AgarProductData> {
        const productData: AgarProductData = {
            productName,
            pdfPath: filePath,
            category: this.categorizeAgarProduct(productName),
            ingredients: this.extractIngredients(text),
            usageInstructions: this.extractUsageInstructions(text),
            safetyInformation: this.extractSafetyInformation(text),
            applications: this.extractApplications(text),
            technicalSpecs: this.extractTechnicalSpecs(text)
        };

        return productData;
    }

    /**
     * Categorize Agar product based on name and content
     */
    private categorizeAgarProduct(productName: string): string {
        const name = productName.toLowerCase();
        
        if (name.includes('dish') || name.includes('wash')) return 'Dishwashing';
        if (name.includes('laundry') || name.includes('fabric')) return 'Laundry';
        if (name.includes('carpet') || name.includes('upholstery')) return 'Carpet Care';
        if (name.includes('glass') || name.includes('window')) return 'Glass Cleaning';
        if (name.includes('sanitiser') || name.includes('sanitizer') || name.includes('disinfect')) return 'Sanitization';
        if (name.includes('degreaser') || name.includes('grease')) return 'Degreasing';
        if (name.includes('toilet') || name.includes('bowl') || name.includes('bathroom')) return 'Bathroom Cleaning';
        if (name.includes('floor') || name.includes('mop')) return 'Floor Care';
        if (name.includes('kitchen') || name.includes('oven') || name.includes('grill')) return 'Kitchen Cleaning';
        if (name.includes('bleach') || name.includes('stain')) return 'Stain Removal';
        if (name.includes('auto') || name.includes('car') || name.includes('truck')) return 'Automotive';
        if (name.includes('hand') || name.includes('soap')) return 'Hand Care';
        if (name.includes('air') || name.includes('fresh') || name.includes('fragrance')) return 'Air Care';
        
        return 'General Purpose';
    }

    /**
     * Extract ingredients from product text
     */
    private extractIngredients(text: string): string[] {
        const ingredients: string[] = [];
        const ingredientPatterns = [
            /ingredients?:?\s*([^\n\r.]+)/gi,
            /contains?:?\s*([^\n\r.]+)/gi,
            /active ingredients?:?\s*([^\n\r.]+)/gi
        ];

        for (const pattern of ingredientPatterns) {
            const matches = text.match(pattern);
            if (matches) {
                matches.forEach(match => {
                    const content = match.replace(/^(ingredients?|contains?|active ingredients?):?\s*/i, '').trim();
                    if (content.length > 5 && content.length < 200) {
                        ingredients.push(content);
                    }
                });
            }
        }

        return [...new Set(ingredients)];
    }

    /**
     * Extract usage instructions
     */
    private extractUsageInstructions(text: string): string[] {
        const instructions: string[] = [];
        const patterns = [
            /directions?:?\s*([^\n\r]+)/gi,
            /usage:?\s*([^\n\r]+)/gi,
            /how to use:?\s*([^\n\r]+)/gi,
            /application:?\s*([^\n\r]+)/gi
        ];

        for (const pattern of patterns) {
            const matches = text.match(pattern);
            if (matches) {
                matches.forEach(match => {
                    const content = match.replace(/^(directions?|usage|how to use|application):?\s*/i, '').trim();
                    if (content.length > 10 && content.length < 500) {
                        instructions.push(content);
                    }
                });
            }
        }

        return [...new Set(instructions)];
    }

    /**
     * Extract safety information
     */
    private extractSafetyInformation(text: string): string[] {
        const safety: string[] = [];
        const patterns = [
            /safety:?\s*([^\n\r]+)/gi,
            /warning:?\s*([^\n\r]+)/gi,
            /caution:?\s*([^\n\r]+)/gi,
            /hazard:?\s*([^\n\r]+)/gi,
            /precaution:?\s*([^\n\r]+)/gi
        ];

        for (const pattern of patterns) {
            const matches = text.match(pattern);
            if (matches) {
                matches.forEach(match => {
                    const content = match.replace(/^(safety|warning|caution|hazard|precaution):?\s*/i, '').trim();
                    if (content.length > 10 && content.length < 300) {
                        safety.push(content);
                    }
                });
            }
        }

        return [...new Set(safety)];
    }

    /**
     * Extract applications/uses
     */
    private extractApplications(text: string): string[] {
        const applications: string[] = [];
        const patterns = [
            /applications?:?\s*([^\n\r]+)/gi,
            /uses?:?\s*([^\n\r]+)/gi,
            /suitable for:?\s*([^\n\r]+)/gi
        ];

        for (const pattern of patterns) {
            const matches = text.match(pattern);
            if (matches) {
                matches.forEach(match => {
                    const content = match.replace(/^(applications?|uses?|suitable for):?\s*/i, '').trim();
                    if (content.length > 10 && content.length < 300) {
                        applications.push(content);
                    }
                });
            }
        }

        return [...new Set(applications)];
    }

    /**
     * Extract technical specifications
     */
    private extractTechnicalSpecs(text: string): Record<string, string> {
        const specs: Record<string, string> = {};
        
        // Common spec patterns for cleaning products
        const specPatterns = [
            { key: 'ph', pattern: /ph:?\s*([\d.-]+)/gi },
            { key: 'density', pattern: /density:?\s*([\d.-]+\s*g\/ml)/gi },
            { key: 'color', pattern: /colou?r:?\s*([^\n\r,]+)/gi },
            { key: 'odor', pattern: /odou?r:?\s*([^\n\r,]+)/gi },
            { key: 'appearance', pattern: /appearance:?\s*([^\n\r,]+)/gi },
            { key: 'dilution', pattern: /dilution:?\s*([^\n\r,]+)/gi }
        ];

        for (const { key, pattern } of specPatterns) {
            const match = text.match(pattern);
            if (match && match[0]) {
                specs[key] = match[0].replace(new RegExp(`^${key}:?\\s*`, 'i'), '').trim();
            }
        }

        return specs;
    }

    /**
     * Extract Agar-specific entities
     */
    private extractAgarEntities(text: string): string[] {
        const entities: string[] = [];
        
        // Cleaning-specific terms
        const cleaningTerms = [
            'disinfectant', 'detergent', 'sanitizer', 'degreaser', 'bleach',
            'surfactant', 'enzyme', 'solvent', 'emulsifier', 'pH', 'alkaline', 'acidic',
            'biodegradable', 'phosphate-free', 'concentrated', 'dilution'
        ];

        for (const term of cleaningTerms) {
            if (text.toLowerCase().includes(term.toLowerCase())) {
                entities.push(term);
            }
        }

        return [...new Set(entities)];
    }

    /**
     * Create Agar product entity with detailed product information
     */
    private async createAgarProductEntity(
        documentId: string,
        productData: AgarProductData,
        pdfData: any
    ): Promise<void> {
        const observations = [
            `Product name: ${productData.productName}`,
            `Category: ${productData.category}`,
            `Pages: ${pdfData.numpages}`,
            `Processing date: ${new Date().toISOString()}`,
            `File type: Agar Product Data Sheet`
        ];

        if (productData.ingredients?.length) {
            observations.push(`Ingredients: ${productData.ingredients.slice(0, 3).join('; ')}`);
        }

        if (productData.applications?.length) {
            observations.push(`Applications: ${productData.applications.slice(0, 2).join('; ')}`);
        }

        if (productData.technicalSpecs && Object.keys(productData.technicalSpecs).length) {
            const specs = Object.entries(productData.technicalSpecs)
                .slice(0, 3)
                .map(([key, value]) => `${key}: ${value}`)
                .join('; ');
            observations.push(`Technical specs: ${specs}`);
        }

        const productEntity: Entity = {
            name: documentId,
            entityType: 'agar_product',
            observations
        };

        await this.knowledgeGraph.createEntities([productEntity]);
        console.log(`Created Agar product entity: ${productData.productName}`);
    }

    /**
     * Create product-aware chunks
     */
    private async createAgarProductChunks(
        text: string,
        documentId: string,
        productName: string,
        pageCount: number,
        productData: AgarProductData
    ): Promise<any[]> {
        // Use parent method but add Agar-specific context
        const chunks = await this.createTextChunks(text, documentId, productName, pageCount);
        
        // Enhance chunks with product context
        return chunks.map(chunk => ({
            ...chunk,
            metadata: {
                ...chunk.metadata,
                productCategory: productData.category,
                productName: productData.productName,
                isAgarProduct: true
            }
        }));
    }

    /**
     * Create Agar-specific relationships
     */
    private async createAgarProductRelationships(
        documentId: string,
        productData: AgarProductData,
        chunks: any[]
    ): Promise<void> {
        const relations: Relation[] = [];

        // Create category relationship
        const categoryEntityName = `agar_category_${productData.category.toLowerCase().replace(/\s+/g, '_')}`;
        
        // Create category entity if it doesn't exist
        await this.knowledgeGraph.createEntities([{
            name: categoryEntityName,
            entityType: 'product_category',
            observations: [
                `Category: ${productData.category}`,
                `Agar cleaning product category`,
                `Used for organizing product catalog`
            ]
        }]);

        relations.push({
            from: documentId,
            to: categoryEntityName,
            relationType: 'belongs_to_category'
        });

        // Create relationships with Agar brand
        await this.knowledgeGraph.createEntities([{
            name: 'agar_cleaning_systems',
            entityType: 'brand',
            observations: [
                'Brand: Agar Cleaning Systems',
                'Australian cleaning products manufacturer',
                'Professional and commercial cleaning solutions'
            ]
        }]);

        relations.push({
            from: documentId,
            to: 'agar_cleaning_systems',
            relationType: 'manufactured_by'
        });

        // Create application relationships
        if (productData.applications?.length) {
            for (const application of productData.applications.slice(0, 5)) {
                const appEntityName = `application_${application.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30)}`;
                
                await this.knowledgeGraph.createEntities([{
                    name: appEntityName,
                    entityType: 'application',
                    observations: [
                        `Application: ${application}`,
                        `Use case for cleaning products`
                    ]
                }]);

                relations.push({
                    from: documentId,
                    to: appEntityName,
                    relationType: 'used_for'
                });
            }
        }

        if (relations.length > 0) {
            await this.knowledgeGraph.createRelations(relations);
            console.log(`Created ${relations.length} Agar product relationships for ${productData.productName}`);
        }
    }

    /**
     * Search for Agar products by category, name, or application
     */
    async searchAgarProducts(
        query: string,
        options?: {
            category?: string;
            limit?: number;
            includeIngredients?: boolean;
        }
    ): Promise<any> {
        let searchQuery = query;
        
        if (options?.category) {
            searchQuery += ` category:${options.category}`;
        }

        return await this.knowledgeGraph.search(searchQuery, {
            limit: options?.limit || 10,
            entityTypes: ['agar_product', 'document_chunk'],
            hybridSearch: true,
            semanticSearch: true
        });
    }

    /**
     * Get all products in a specific category
     */
    async getProductsByCategory(category: string): Promise<any> {
        return await this.knowledgeGraph.searchNodes(`category ${category} agar`);
    }

    /**
     * Get processing statistics
     */
    getProcessingStats(): {
        totalProducts: number;
        categories: Record<string, number>;
        topCategories: Array<{category: string, count: number}>;
    } {
        const categories: Record<string, number> = {};
        
        for (const product of this.processedProducts.values()) {
            categories[product.category] = (categories[product.category] || 0) + 1;
        }

        const topCategories = Object.entries(categories)
            .map(([category, count]) => ({ category, count }))
            .sort((a, b) => b.count - a.count);

        return {
            totalProducts: this.processedProducts.size,
            categories,
            topCategories
        };
    }
}
