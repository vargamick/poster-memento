import type { Entity, KnowledgeGraph } from '../../KnowledgeGraphManager.js';
import type { StorageProvider } from '../../storage/StorageProvider.js';
import { ExpertiseAreaManager, type KnowledgeContext, type ValidationResult } from '../domain/ExpertiseArea.js';
import { logger } from '../../utils/logger.js';

export interface EntityCreateOptions {
  expertiseArea?: string;
  context?: KnowledgeContext;
  validateOnly?: boolean;
  skipValidation?: boolean;
}

export interface EntityUpdateOptions {
  expertiseArea?: string;
  context?: KnowledgeContext;
  validateOnly?: boolean;
  skipValidation?: boolean;
}

export interface EntitySearchOptions {
  limit?: number;
  offset?: number;
  entityTypes?: string[];
  expertiseArea?: string;
  includeValidation?: boolean;
}

export interface EntityServiceResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
  warnings?: string[];
  suggestions?: string[];
  validation?: ValidationResult;
}

/**
 * Service layer for entity operations
 * Provides business logic and expertise area integration
 */
export class EntityService {
  constructor(
    private storageProvider: StorageProvider,
    private expertiseAreaManager: ExpertiseAreaManager
  ) {}

  /**
   * Create new entities with expertise area validation and enrichment
   */
  async createEntities(
    entities: Entity[],
    options: EntityCreateOptions = {}
  ): Promise<EntityServiceResult<Entity[]>> {
    try {
      const {
        expertiseArea = 'default',
        context,
        validateOnly = false,
        skipValidation = false
      } = options;

      // Prepare context
      const knowledgeContext: KnowledgeContext = context || {
        domain: expertiseArea,
        timestamp: Date.now(),
        metadata: {}
      };

      const processedEntities: Entity[] = [];
      const allErrors: string[] = [];
      const allWarnings: string[] = [];
      const allSuggestions: string[] = [];

      // Process each entity
      for (const entity of entities) {
        let processedEntity = { ...entity };

        // Validate entity if not skipped
        if (!skipValidation) {
          const validation = this.expertiseAreaManager.validateEntity(
            processedEntity,
            expertiseArea,
            knowledgeContext
          );

          if (!validation.isValid) {
            allErrors.push(...(validation.errors || []));
            if (this.expertiseAreaManager.getExpertiseArea(expertiseArea)?.config.strictValidation) {
              return {
                success: false,
                errors: allErrors,
                warnings: validation.warnings,
                suggestions: validation.suggestions,
                validation
              };
            }
          }

          allWarnings.push(...(validation.warnings || []));
          allSuggestions.push(...(validation.suggestions || []));
        }

        // Enrich entity with expertise area context
        processedEntity = this.expertiseAreaManager.enrichEntity(
          processedEntity,
          expertiseArea,
          knowledgeContext
        );

        processedEntities.push(processedEntity);
      }

      // If validation only, return without creating
      if (validateOnly) {
        return {
          success: allErrors.length === 0,
          data: processedEntities,
          errors: allErrors.length > 0 ? allErrors : undefined,
          warnings: allWarnings.length > 0 ? allWarnings : undefined,
          suggestions: allSuggestions.length > 0 ? allSuggestions : undefined
        };
      }

      // Create entities in storage
      const createdEntities = await this.storageProvider.createEntities(processedEntities);

      // Apply after-create hooks
      const area = this.expertiseAreaManager.getExpertiseArea(expertiseArea);
      if (area?.hooks?.afterEntityCreate) {
        for (const entity of createdEntities) {
          area.hooks.afterEntityCreate(entity, knowledgeContext);
        }
      }

      logger.info(`Created ${createdEntities.length} entities in expertise area: ${expertiseArea}`);

      return {
        success: true,
        data: createdEntities,
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
        suggestions: allSuggestions.length > 0 ? allSuggestions : undefined
      };

    } catch (error) {
      logger.error('Error creating entities', error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Update an existing entity
   */
  async updateEntity(
    entityName: string,
    updates: Partial<Entity>,
    options: EntityUpdateOptions = {}
  ): Promise<EntityServiceResult<Entity>> {
    try {
      const {
        expertiseArea = 'default',
        context,
        validateOnly = false,
        skipValidation = false
      } = options;

      // Get existing entity
      const existingEntity = await this.storageProvider.getEntity(entityName);
      if (!existingEntity) {
        return {
          success: false,
          errors: [`Entity '${entityName}' not found`]
        };
      }

      // Merge updates
      const updatedEntity = { ...existingEntity, ...updates };

      // Prepare context
      const knowledgeContext: KnowledgeContext = context || {
        domain: expertiseArea,
        timestamp: Date.now(),
        metadata: {}
      };

      // Validate if not skipped
      if (!skipValidation) {
        const validation = this.expertiseAreaManager.validateEntity(
          updatedEntity,
          expertiseArea,
          knowledgeContext
        );

        if (!validation.isValid) {
          const area = this.expertiseAreaManager.getExpertiseArea(expertiseArea);
          if (area?.config.strictValidation) {
            return {
              success: false,
              errors: validation.errors,
              warnings: validation.warnings,
              suggestions: validation.suggestions,
              validation
            };
          }
        }
      }

      // If validation only, return without updating
      if (validateOnly) {
        return {
          success: true,
          data: updatedEntity
        };
      }

      // Update in storage
      if (typeof (this.storageProvider as any).updateEntity === 'function') {
        const result = await (this.storageProvider as any).updateEntity(entityName, updates);
        logger.info(`Updated entity '${entityName}' in expertise area: ${expertiseArea}`);
        return {
          success: true,
          data: result
        };
      } else {
        return {
          success: false,
          errors: ['Entity updates not supported by storage provider']
        };
      }

    } catch (error) {
      logger.error(`Error updating entity '${entityName}'`, error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Get an entity by name
   */
  async getEntity(entityName: string): Promise<EntityServiceResult<Entity>> {
    try {
      const entity = await this.storageProvider.getEntity(entityName);
      
      if (!entity) {
        return {
          success: false,
          errors: [`Entity '${entityName}' not found`]
        };
      }

      return {
        success: true,
        data: entity
      };

    } catch (error) {
      logger.error(`Error getting entity '${entityName}'`, error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Delete entities
   */
  async deleteEntities(entityNames: string[]): Promise<EntityServiceResult<void>> {
    try {
      await this.storageProvider.deleteEntities(entityNames);
      logger.info(`Deleted ${entityNames.length} entities`);
      
      return {
        success: true
      };

    } catch (error) {
      logger.error('Error deleting entities', error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Search entities with expertise area context
   */
  async searchEntities(
    query: string,
    options: EntitySearchOptions = {}
  ): Promise<EntityServiceResult<KnowledgeGraph>> {
    try {
      const {
        limit = 10,
        offset = 0,
        entityTypes,
        expertiseArea,
        includeValidation = false
      } = options;

      // Build search options - request enough results for pagination
      const searchOptions = {
        limit: limit + offset, // Request extra to handle offset
        entityTypes,
        caseSensitive: false
      };

      // Perform search
      const results = await this.storageProvider.searchNodes(query, searchOptions);

      // Filter by expertise area if specified
      if (expertiseArea && expertiseArea !== 'default') {
        const area = this.expertiseAreaManager.getExpertiseArea(expertiseArea);
        if (area) {
          results.entities = results.entities.filter(entity => {
            // Check if entity type is supported by expertise area
            return area.entityTypes.includes('*') || area.entityTypes.includes(entity.entityType);
          });
        }
      }

      // Apply pagination - skip 'offset' items and take 'limit' items
      if (offset > 0 || results.entities.length > limit) {
        results.entities = results.entities.slice(offset, offset + limit);
        results.relations = results.relations.slice(offset, offset + limit);
      }

      // Add validation information if requested
      if (includeValidation && expertiseArea) {
        const context: KnowledgeContext = {
          domain: expertiseArea,
          timestamp: Date.now(),
          metadata: { searchQuery: query }
        };

        for (const entity of results.entities) {
          const validation = this.expertiseAreaManager.validateEntity(
            entity,
            expertiseArea,
            context
          );
          
          // Add validation info to entity metadata
          (entity as any).validation = validation;
        }
      }

      return {
        success: true,
        data: results
      };

    } catch (error) {
      logger.error('Error searching entities', error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Add observations to entities
   */
  async addObservations(
    observations: Array<{
      entityName: string;
      contents: string[];
      expertiseArea?: string;
      context?: KnowledgeContext;
    }>
  ): Promise<EntityServiceResult<Array<{ entityName: string; addedObservations: string[] }>>> {
    try {
      // Process observations with expertise area context
      const processedObservations = observations.map(obs => ({
        entityName: obs.entityName,
        contents: obs.contents
      }));

      const results = await this.storageProvider.addObservations(processedObservations);
      
      logger.info(`Added observations to ${results.length} entities`);

      return {
        success: true,
        data: results
      };

    } catch (error) {
      logger.error('Error adding observations', error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Delete observations from entities
   */
  async deleteObservations(
    deletions: Array<{ entityName: string; observations: string[] }>
  ): Promise<EntityServiceResult<void>> {
    try {
      await this.storageProvider.deleteObservations(deletions);
      logger.info(`Deleted observations from ${deletions.length} entities`);

      return {
        success: true
      };

    } catch (error) {
      logger.error('Error deleting observations', error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Get entity history if supported
   */
  async getEntityHistory(entityName: string): Promise<EntityServiceResult<Entity[]>> {
    try {
      if (typeof this.storageProvider.getEntityHistory !== 'function') {
        return {
          success: false,
          errors: ['Entity history not supported by storage provider']
        };
      }

      const history = await this.storageProvider.getEntityHistory(entityName);
      
      return {
        success: true,
        data: history
      };

    } catch (error) {
      logger.error(`Error getting entity history for '${entityName}'`, error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Get all available expertise areas
   */
  getExpertiseAreas(): EntityServiceResult<Array<{ name: string; description: string; version: string }>> {
    try {
      const areas = this.expertiseAreaManager.getAllExpertiseAreas().map(area => ({
        name: area.name,
        description: area.description,
        version: area.version
      }));

      return {
        success: true,
        data: areas
      };

    } catch (error) {
      logger.error('Error getting expertise areas', error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Get expertise area details
   */
  getExpertiseAreaDetails(areaName: string): EntityServiceResult<any> {
    try {
      const area = this.expertiseAreaManager.getExpertiseArea(areaName);
      
      if (!area) {
        return {
          success: false,
          errors: [`Expertise area '${areaName}' not found`]
        };
      }

      // Return area without the validator functions (not serializable)
      const areaDetails = {
        name: area.name,
        description: area.description,
        version: area.version,
        entityTypes: area.entityTypes,
        relationTypes: area.relationTypes,
        observationPatterns: area.observationPatterns,
        semanticContext: area.semanticContext,
        config: area.config,
        validationRules: area.validationRules.map(rule => ({
          name: rule.name,
          description: rule.description
        }))
      };

      return {
        success: true,
        data: areaDetails
      };

    } catch (error) {
      logger.error(`Error getting expertise area details for '${areaName}'`, error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }
}
