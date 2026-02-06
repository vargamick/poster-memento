import express from 'express';
import cors from 'cors';
import type { StorageProvider } from '../storage/StorageProvider.js';
import { EntityService } from '../core/services/EntityService.js';
import { RelationService } from '../core/services/RelationService.js';
import { SearchService } from '../core/services/SearchService.js';
import { expertiseAreaManager } from '../core/domain/ExpertiseArea.js';
import { logger } from '../utils/logger.js';

// Import route handlers
import { createEntityRoutes } from './routes/entities.js';
import { createRelationRoutes } from './routes/relations.js';
import { createSearchRoutes } from './routes/search.js';
import { createAnalyticsRoutes } from './routes/analytics.js';
import { createTemporalRoutes } from './routes/temporal.js';
import { createExpertiseRoutes } from './routes/expertise.js';
import { createAdminRoutes } from './routes/admin.js';
import { createProcessingRoutes } from './routes/processing.js';
import { createImageRoutes } from './routes/images.js';
import { createPosterRoutes } from './routes/posters.js';
import { createQAValidationRoutes } from './routes/qa-validation.js';
import { createIterativeProcessingRoutes } from './routes/iterative-processing.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createLiveRoutes } from './routes/live.js';
import { createMigrationRoutes } from './routes/migration.js';
import { createImageStorageService, getStorageType } from '../image-processor/imageStorageFactory.js';
import { QAValidationService } from '../qa-validation/QAValidationService.js';

// Import admin services
import {
  createAdminServiceFromEnv,
  createS3ServiceFromEnv,
  createProcessingServiceFromEnv,
  MetadataProcessingService,
  PdfProcessingService,
  EmbeddingProcessingService
} from '../services/index.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { validateApiKey } from './middleware/auth.js';

export interface ApiServerOptions {
  port?: number;
  host?: string;
  enableCors?: boolean;
  corsOrigins?: string[];
  requireApiKey?: boolean;
  apiKeys?: string[];
  rateLimit?: {
    windowMs: number;
    max: number;
  };
}

export interface ApiServerDependencies {
  storageProvider: StorageProvider;
  knowledgeGraphManager?: any; // For backward compatibility
  vectorStore?: any; // Optional vector store for hybrid search
  embeddingService?: any; // Optional embedding service for hybrid search
}

/**
 * Creates and configures the Express API server
 */
export function createApiServer(
  dependencies: ApiServerDependencies,
  options: ApiServerOptions = {}
): express.Application {
  const app = express();

  // Extract options with defaults
  const {
    enableCors = true,
    corsOrigins = ['*'],
    requireApiKey = false,
    apiKeys = []
  } = options;

  // Create service instances
  const entityService = new EntityService(dependencies.storageProvider, expertiseAreaManager);
  const relationService = new RelationService(dependencies.storageProvider, expertiseAreaManager);

  // Create SearchService if vector store and embedding service are available
  let searchService: SearchService | undefined;
  if (dependencies.vectorStore && dependencies.embeddingService) {
    const defaultStrategy = (process.env.DEFAULT_SEARCH_STRATEGY as 'graph' | 'vector' | 'hybrid') || 'hybrid';
    searchService = new SearchService(
      dependencies.storageProvider,
      dependencies.vectorStore,
      dependencies.embeddingService,
      {
        defaultStrategy,
        hybridConfig: {
          graphWeight: parseFloat(process.env.HYBRID_GRAPH_WEIGHT || '0.4'),
          vectorWeight: parseFloat(process.env.HYBRID_VECTOR_WEIGHT || '0.6'),
          deduplication: process.env.HYBRID_DEDUPLICATION !== 'false',
          rerankingEnabled: process.env.HYBRID_RERANKING === 'true',
          mergeMethod: (process.env.HYBRID_MERGE_METHOD as 'weighted' | 'rrf') || 'weighted'
        },
        enableMetadataFiltering: process.env.ENABLE_METADATA_FILTERING !== 'false',
        enableQueryAnalysis: process.env.ENABLE_QUERY_ANALYSIS !== 'false'
      }
    );
    logger.info('SearchService initialized with hybrid search support');
  } else {
    logger.info('SearchService not initialized - vector store or embedding service not available');
  }

  // Basic middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // CORS middleware
  if (enableCors) {
    app.use(cors({
      origin: corsOrigins.includes('*') ? true : corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
    }));
  }

  // Request logging
  app.use(requestLogger);

  // API key authentication (if required)
  if (requireApiKey && apiKeys.length > 0) {
    app.use('/api', validateApiKey(apiKeys));
  }

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime()
    });
  });

  // API info endpoint
  app.get('/api', (req, res) => {
    res.json({
      name: '3DN Memento API',
      version: '1.0.0',
      description: 'REST API for 3DN Memento Knowledge Graph',
      endpoints: {
        entities: '/api/v1/entities',
        relations: '/api/v1/relations',
        search: '/api/v1/search',
        analytics: '/api/v1/analytics',
        temporal: '/api/v1/temporal',
        expertise: '/api/v1/expertise-areas',
        images: '/api/v1/images',
        admin: '/api/v1/admin',
        processing: '/api/v1/processing',
        sessions: '/api/v1/sessions',
        live: '/api/v1/live',
        migration: '/api/v1/migration',
        qaValidation: '/api/v1/qa-validation',
        iterative: '/api/v1/iterative'
      },
      documentation: '/api/docs',
      adminUI: '/admin'
    });
  });

  // Mount API routes
  const apiV1 = express.Router();
  
  // Entity routes (pass storageProvider for Poster type enrichment)
  apiV1.use('/entities', createEntityRoutes(entityService, dependencies.storageProvider));
  
  // Relation routes
  apiV1.use('/relations', createRelationRoutes(relationService));
  
  // Search routes (with optional SearchService for hybrid search)
  apiV1.use('/search', createSearchRoutes(entityService, dependencies.storageProvider, searchService));
  
  // Analytics routes
  apiV1.use('/analytics', createAnalyticsRoutes(dependencies.knowledgeGraphManager || dependencies.storageProvider));
  
  // Temporal routes
  apiV1.use('/temporal', createTemporalRoutes(dependencies.storageProvider));
  
  // Expertise area routes
  apiV1.use('/expertise-areas', createExpertiseRoutes(entityService));

  // Image routes (for presigned URLs from S3 or MinIO)
  if (process.env.S3_BUCKET || process.env.MINIO_ENDPOINT || process.env.IMAGE_STORAGE_ENABLED !== 'false') {
    try {
      const imageStorage = createImageStorageService();
      const storageType = getStorageType();
      apiV1.use('/images', createImageRoutes(imageStorage));
      logger.info(`Image routes enabled at /api/v1/images (using ${storageType})`);
    } catch (error: any) {
      logger.warn('Image routes not initialized', { error: error.message });
    }
  }

  // Admin routes (conditionally enabled)
  if (process.env.ADMIN_ENABLED !== 'false') {
    try {
      const adminService = createAdminServiceFromEnv();
      const s3Service = createS3ServiceFromEnv();
      const processingService = createProcessingServiceFromEnv();
      apiV1.use('/admin', createAdminRoutes(adminService, s3Service, processingService));
      logger.info('Admin routes enabled at /api/v1/admin');
    } catch (error: any) {
      logger.warn('Admin routes not initialized', { error: error.message });
    }
  }

  // Processing routes (for external frontend consumption)
  if (process.env.PROCESSING_ENABLED !== 'false') {
    try {
      // Create processing services
      const metadataProcessingService = new MetadataProcessingService(
        entityService,
        relationService,
        {
          catalogPath: process.env.CATALOG_PATH,
          defaultExpertiseArea: process.env.DEFAULT_EXPERTISE_AREA || 'agar'
        }
      );

      const pdfProcessingService = new PdfProcessingService(
        entityService,
        relationService,
        {
          catalogPath: process.env.CATALOG_PATH,
          defaultExpertiseArea: process.env.DEFAULT_EXPERTISE_AREA || 'agar'
        }
      );

      const embeddingProcessingService = new EmbeddingProcessingService(
        entityService,
        dependencies.storageProvider,
        dependencies.embeddingService || null,
        {
          defaultEntityTypes: ['agar_product', 'document_chunk'],
          batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '10'),
          delayBetweenBatches: parseInt(process.env.EMBEDDING_DELAY_MS || '1000')
        }
      );

      apiV1.use('/processing', createProcessingRoutes(
        metadataProcessingService,
        pdfProcessingService,
        embeddingProcessingService
      ));
      logger.info('Processing routes enabled at /api/v1/processing');
    } catch (error: any) {
      logger.warn('Processing routes not initialized', { error: error.message });
    }
  }

  // Poster processing routes (for poster image processing UI)
  if (process.env.POSTER_PROCESSING_ENABLED !== 'false' && dependencies.knowledgeGraphManager) {
    try {
      apiV1.use('/posters', createPosterRoutes(dependencies.knowledgeGraphManager));
      logger.info('Poster processing routes enabled at /api/v1/posters');
    } catch (error: any) {
      logger.warn('Poster processing routes not initialized', { error: error.message });
    }
  }

  // Session routes (for upload sessions - staging areas for images)
  if (process.env.SESSION_ROUTES_ENABLED !== 'false' && dependencies.knowledgeGraphManager) {
    try {
      apiV1.use('/sessions', createSessionRoutes(dependencies.knowledgeGraphManager));
      logger.info('Session routes enabled at /api/v1/sessions');
    } catch (error: any) {
      logger.warn('Session routes not initialized', { error: error.message });
    }
  }

  // Live routes (for canonical image storage - one per KG entity)
  if (process.env.LIVE_ROUTES_ENABLED !== 'false' && dependencies.knowledgeGraphManager) {
    try {
      apiV1.use('/live', createLiveRoutes(dependencies.knowledgeGraphManager));
      logger.info('Live routes enabled at /api/v1/live');
    } catch (error: any) {
      logger.warn('Live routes not initialized', { error: error.message });
    }
  }

  // Migration routes (for migrating from old flat structure to session/live structure)
  if (process.env.MIGRATION_ENABLED !== 'false') {
    try {
      apiV1.use('/migration', createMigrationRoutes(entityService));
      logger.info('Migration routes enabled at /api/v1/migration');
    } catch (error: any) {
      logger.warn('Migration routes not initialized', { error: error.message });
    }
  }

  // QA Validation routes (for validating processed poster data)
  if (process.env.QA_VALIDATION_ENABLED !== 'false') {
    try {
      const qaService = new QAValidationService({
        entityService,
        discogsToken: process.env.DISCOGS_TOKEN,
        tmdbApiKey: process.env.TMDB_API_KEY,
      });
      apiV1.use('/qa-validation', createQAValidationRoutes(qaService));
      logger.info('QA Validation routes enabled at /api/v1/qa-validation');
    } catch (error: any) {
      logger.warn('QA Validation routes not initialized', { error: error.message });
    }
  }

  // Iterative Processing routes (for multi-phase poster processing)
  if (process.env.ITERATIVE_PROCESSING_ENABLED !== 'false') {
    try {
      apiV1.use('/iterative', createIterativeProcessingRoutes(
        entityService,
        relationService,
        searchService,
        process.env.DISCOGS_TOKEN
      ));
      logger.info('Iterative Processing routes enabled at /api/v1/iterative');
    } catch (error: any) {
      logger.warn('Iterative Processing routes not initialized', { error: error.message });
    }
  }

  // Mount API v1
  app.use('/api/v1', apiV1);

  // Error handling middleware (must be last)
  app.use(errorHandler);

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Route ${req.method} ${req.originalUrl} not found`,
      availableEndpoints: [
        'GET /health',
        'GET /api',
        'GET /api/v1/entities',
        'POST /api/v1/entities',
        'GET /api/v1/relations',
        'POST /api/v1/relations',
        'GET /api/v1/search',
        'GET /api/v1/analytics/statistics',
        'GET /api/v1/expertise-areas',
        'GET /api/v1/images/:hash',
        'POST /api/v1/images/batch'
      ]
    });
  });

  return app;
}

/**
 * Starts the API server
 */
export async function startApiServer(
  dependencies: ApiServerDependencies,
  options: ApiServerOptions = {}
): Promise<{ app: express.Application; server: any }> {
  const {
    port = process.env.API_PORT ? parseInt(process.env.API_PORT) : 3000,
    host = process.env.API_HOST || '0.0.0.0'
  } = options;

  const app = createApiServer(dependencies, options);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      logger.info(`3DN Memento API server started on ${host}:${port}`);
      logger.info(`Health check: http://${host}:${port}/health`);
      logger.info(`API info: http://${host}:${port}/api`);
      resolve({ app, server });
    });

    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${port} is already in use`);
      } else {
        logger.error('Failed to start API server', error);
      }
      reject(error);
    });
  });
}

/**
 * Gracefully shuts down the API server
 */
export function shutdownApiServer(server: any): Promise<void> {
  return new Promise((resolve) => {
    logger.info('Shutting down API server...');
    server.close(() => {
      logger.info('API server shut down successfully');
      resolve();
    });
  });
}
