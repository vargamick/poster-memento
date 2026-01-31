import type { Relation } from '../../types/relation.js';
import type { StorageProvider } from '../../storage/StorageProvider.js';
import { ExpertiseAreaManager, type KnowledgeContext, type ValidationResult } from '../domain/ExpertiseArea.js';
import { logger } from '../../utils/logger.js';

export interface RelationCreateOptions {
  expertiseArea?: string;
  context?: KnowledgeContext;
  validateOnly?: boolean;
  skipValidation?: boolean;
}

export interface RelationUpdateOptions {
  expertiseArea?: string;
  context?: KnowledgeContext;
  validateOnly?: boolean;
  skipValidation?: boolean;
}

export interface RelationServiceResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
  warnings?: string[];
  suggestions?: string[];
  validation?: ValidationResult;
}

/**
 * Service layer for relation operations
 * Provides business logic and expertise area integration
 */
export class RelationService {
  constructor(
    private storageProvider: StorageProvider,
    private expertiseAreaManager: ExpertiseAreaManager
  ) {}

  /**
   * Create new relations with expertise area validation and enrichment
   */
  async createRelations(
    relations: Relation[],
    options: RelationCreateOptions = {}
  ): Promise<RelationServiceResult<Relation[]>> {
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

      const processedRelations: Relation[] = [];
      const allErrors: string[] = [];
      const allWarnings: string[] = [];
      const allSuggestions: string[] = [];

      // Get expertise area for validation
      const area = this.expertiseAreaManager.getExpertiseArea(expertiseArea);

      // Process each relation
      for (const relation of relations) {
        let processedRelation = { ...relation };

        // Validate relation if not skipped
        if (!skipValidation && area) {
          // Check if relation type is supported by expertise area
          if (!area.relationTypes.includes('*') && !area.relationTypes.includes(relation.relationType)) {
            const warning = `Relation type '${relation.relationType}' not defined in expertise area '${expertiseArea}'`;
            allWarnings.push(warning);
            
            if (area.config.strictValidation) {
              allErrors.push(warning);
            }
          }

          // Apply before-create hook if available
          if (area.hooks?.beforeRelationCreate) {
            processedRelation = area.hooks.beforeRelationCreate(processedRelation, knowledgeContext);
          }
        }

        // Add expertise area metadata
        const now = Date.now();
        if (!processedRelation.metadata) {
          processedRelation.metadata = {
            createdAt: now,
            updatedAt: now
          };
        }
        
        // Add custom metadata fields (extending the base metadata)
        (processedRelation.metadata as any).expertiseArea = expertiseArea;
        (processedRelation.metadata as any).enrichedAt = now;

        processedRelations.push(processedRelation);
      }

      // If validation only, return without creating
      if (validateOnly) {
        return {
          success: allErrors.length === 0,
          data: processedRelations,
          errors: allErrors.length > 0 ? allErrors : undefined,
          warnings: allWarnings.length > 0 ? allWarnings : undefined,
          suggestions: allSuggestions.length > 0 ? allSuggestions : undefined
        };
      }

      // Check for strict validation errors
      if (allErrors.length > 0 && area?.config.strictValidation) {
        return {
          success: false,
          errors: allErrors,
          warnings: allWarnings.length > 0 ? allWarnings : undefined,
          suggestions: allSuggestions.length > 0 ? allSuggestions : undefined
        };
      }

      // Create relations in storage
      const createdRelations = await this.storageProvider.createRelations(processedRelations);

      // Apply after-create hooks
      if (area?.hooks?.afterRelationCreate) {
        for (const relation of createdRelations) {
          area.hooks.afterRelationCreate(relation, knowledgeContext);
        }
      }

      logger.info(`Created ${createdRelations.length} relations in expertise area: ${expertiseArea}`);

      return {
        success: true,
        data: createdRelations,
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
        suggestions: allSuggestions.length > 0 ? allSuggestions : undefined
      };

    } catch (error) {
      logger.error('Error creating relations', error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Get a specific relation
   */
  async getRelation(
    from: string,
    to: string,
    relationType: string
  ): Promise<RelationServiceResult<Relation>> {
    try {
      if (typeof this.storageProvider.getRelation !== 'function') {
        return {
          success: false,
          errors: ['Get relation not supported by storage provider']
        };
      }

      const relation = await this.storageProvider.getRelation(from, to, relationType);
      
      if (!relation) {
        return {
          success: false,
          errors: [`Relation from '${from}' to '${to}' of type '${relationType}' not found`]
        };
      }

      return {
        success: true,
        data: relation
      };

    } catch (error) {
      logger.error(`Error getting relation from '${from}' to '${to}' of type '${relationType}'`, error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Update an existing relation
   */
  async updateRelation(
    relation: Relation,
    options: RelationUpdateOptions = {}
  ): Promise<RelationServiceResult<Relation>> {
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

      let processedRelation = { ...relation };

      // Validate if not skipped
      if (!skipValidation) {
        const area = this.expertiseAreaManager.getExpertiseArea(expertiseArea);
        
        if (area) {
          // Check if relation type is supported
          if (!area.relationTypes.includes('*') && !area.relationTypes.includes(relation.relationType)) {
            if (area.config.strictValidation) {
              return {
                success: false,
                errors: [`Relation type '${relation.relationType}' not supported in expertise area '${expertiseArea}'`]
              };
            }
          }

          // Apply before-create hook if available (reuse for updates)
          if (area.hooks?.beforeRelationCreate) {
            processedRelation = area.hooks.beforeRelationCreate(processedRelation, knowledgeContext);
          }
        }
      }

      // If validation only, return without updating
      if (validateOnly) {
        return {
          success: true,
          data: processedRelation
        };
      }

      // Update in storage
      if (typeof (this.storageProvider as any).updateRelation === 'function') {
        await (this.storageProvider as any).updateRelation(processedRelation);
        logger.info(`Updated relation from '${relation.from}' to '${relation.to}' of type '${relation.relationType}'`);
        return {
          success: true,
          data: processedRelation
        };
      } else {
        return {
          success: false,
          errors: ['Relation updates not supported by storage provider']
        };
      }

    } catch (error) {
      logger.error(`Error updating relation from '${relation.from}' to '${relation.to}'`, error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Delete relations
   */
  async deleteRelations(relations: Relation[]): Promise<RelationServiceResult<void>> {
    try {
      await this.storageProvider.deleteRelations(relations);
      logger.info(`Deleted ${relations.length} relations`);
      
      return {
        success: true
      };

    } catch (error) {
      logger.error('Error deleting relations', error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Get relation history if supported
   */
  async getRelationHistory(
    from: string,
    to: string,
    relationType: string
  ): Promise<RelationServiceResult<Relation[]>> {
    try {
      if (typeof this.storageProvider.getRelationHistory !== 'function') {
        return {
          success: false,
          errors: ['Relation history not supported by storage provider']
        };
      }

      const history = await this.storageProvider.getRelationHistory(from, to, relationType);
      
      return {
        success: true,
        data: history
      };

    } catch (error) {
      logger.error(`Error getting relation history from '${from}' to '${to}' of type '${relationType}'`, error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Validate relation types against expertise area
   */
  validateRelationTypes(
    relationTypes: string[],
    expertiseArea: string
  ): RelationServiceResult<{ valid: string[]; invalid: string[]; suggestions: string[] }> {
    try {
      const area = this.expertiseAreaManager.getExpertiseArea(expertiseArea);
      
      if (!area) {
        return {
          success: false,
          errors: [`Expertise area '${expertiseArea}' not found`]
        };
      }

      const valid: string[] = [];
      const invalid: string[] = [];
      const suggestions: string[] = [];

      for (const relationType of relationTypes) {
        if (area.relationTypes.includes('*') || area.relationTypes.includes(relationType)) {
          valid.push(relationType);
        } else {
          invalid.push(relationType);
          
          // Try to find similar relation types
          const similar = area.relationTypes.filter(supportedType => 
            supportedType !== '*' && 
            (supportedType.includes(relationType) || relationType.includes(supportedType))
          );
          
          if (similar.length > 0) {
            suggestions.push(`For '${relationType}', consider: ${similar.join(', ')}`);
          }
        }
      }

      return {
        success: true,
        data: { valid, invalid, suggestions }
      };

    } catch (error) {
      logger.error(`Error validating relation types for expertise area '${expertiseArea}'`, error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Get supported relation types for an expertise area
   */
  getSupportedRelationTypes(expertiseArea: string): RelationServiceResult<string[]> {
    try {
      const area = this.expertiseAreaManager.getExpertiseArea(expertiseArea);
      
      if (!area) {
        return {
          success: false,
          errors: [`Expertise area '${expertiseArea}' not found`]
        };
      }

      return {
        success: true,
        data: area.relationTypes
      };

    } catch (error) {
      logger.error(`Error getting supported relation types for expertise area '${expertiseArea}'`, error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }
}
