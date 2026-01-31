/**
 * Expertise Area System for Domain-Specific Knowledge Graph Behavior
 * 
 * This system allows the knowledge graph to adapt its behavior based on
 * different areas of expertise or knowledge domains.
 */

export interface ValidationRule {
  name: string;
  description: string;
  validator: (entity: any, context?: KnowledgeContext) => ValidationResult;
}

export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
  warnings?: string[];
  suggestions?: string[];
}

export interface SemanticContext {
  synonyms: Record<string, string[]>;
  relatedConcepts: Record<string, string[]>;
  hierarchies: Record<string, string[]>;
  constraints: Record<string, any>;
}

export interface KnowledgeContext {
  domain: string;
  project?: string;
  user?: string;
  timestamp: number;
  metadata: Record<string, any>;
}

export interface ExpertiseArea {
  name: string;
  description: string;
  version: string;
  
  // Core definitions
  entityTypes: string[];
  relationTypes: string[];
  observationPatterns: string[];
  
  // Validation and rules
  validationRules: ValidationRule[];
  
  // Semantic understanding
  semanticContext: SemanticContext;
  
  // Configuration
  config: {
    strictValidation: boolean;
    autoEnrichment: boolean;
    conflictResolution: 'strict' | 'permissive' | 'merge';
  };
  
  // Lifecycle hooks
  hooks?: {
    beforeEntityCreate?: (entity: any, context: KnowledgeContext) => any;
    afterEntityCreate?: (entity: any, context: KnowledgeContext) => void;
    beforeRelationCreate?: (relation: any, context: KnowledgeContext) => any;
    afterRelationCreate?: (relation: any, context: KnowledgeContext) => void;
  };
}

/**
 * Manager for expertise areas
 */
export class ExpertiseAreaManager {
  private expertiseAreas: Map<string, ExpertiseArea> = new Map();
  private defaultArea: ExpertiseArea;

  constructor() {
    this.defaultArea = this.createDefaultExpertiseArea();
    this.expertiseAreas.set('default', this.defaultArea);
    this.initializeBuiltInAreas();
  }

  /**
   * Register a new expertise area
   */
  registerExpertiseArea(area: ExpertiseArea): void {
    this.expertiseAreas.set(area.name, area);
  }

  /**
   * Get an expertise area by name
   */
  getExpertiseArea(name: string): ExpertiseArea | null {
    return this.expertiseAreas.get(name) || null;
  }

  /**
   * Get all registered expertise areas
   */
  getAllExpertiseAreas(): ExpertiseArea[] {
    return Array.from(this.expertiseAreas.values());
  }

  /**
   * Validate an entity against an expertise area
   */
  validateEntity(entity: any, areaName: string, context?: KnowledgeContext): ValidationResult {
    const area = this.getExpertiseArea(areaName) || this.defaultArea;
    
    const results: ValidationResult[] = [];
    
    // Run all validation rules
    for (const rule of area.validationRules) {
      try {
        const result = rule.validator(entity, context);
        results.push(result);
      } catch (error) {
        results.push({
          isValid: false,
          errors: [`Validation rule '${rule.name}' failed: ${error}`]
        });
      }
    }

    // Combine results
    const combinedResult: ValidationResult = {
      isValid: results.every(r => r.isValid),
      errors: results.flatMap(r => r.errors || []),
      warnings: results.flatMap(r => r.warnings || []),
      suggestions: results.flatMap(r => r.suggestions || [])
    };

    return combinedResult;
  }

  /**
   * Enrich an entity with expertise area context
   */
  enrichEntity(entity: any, areaName: string, context: KnowledgeContext): any {
    const area = this.getExpertiseArea(areaName) || this.defaultArea;
    
    let enrichedEntity = { ...entity };

    // Apply before-create hook if available
    if (area.hooks?.beforeEntityCreate) {
      enrichedEntity = area.hooks.beforeEntityCreate(enrichedEntity, context);
    }

    // Add expertise area metadata
    enrichedEntity.expertiseArea = areaName;
    enrichedEntity.enrichedAt = Date.now();
    
    // Apply semantic enrichment
    if (area.config.autoEnrichment) {
      enrichedEntity = this.applySemanticEnrichment(enrichedEntity, area);
    }

    return enrichedEntity;
  }

  /**
   * Apply semantic enrichment based on expertise area
   */
  private applySemanticEnrichment(entity: any, area: ExpertiseArea): any {
    const enriched = { ...entity };
    
    // Add related concepts as observations if they don't exist
    const relatedConcepts = area.semanticContext.relatedConcepts[entity.entityType] || [];
    if (relatedConcepts.length > 0 && area.config.autoEnrichment) {
      const conceptObservations = relatedConcepts.map(concept => 
        `Related to ${concept} in ${area.name} domain`
      );
      enriched.observations = [...(enriched.observations || []), ...conceptObservations];
    }

    return enriched;
  }

  /**
   * Create the default expertise area
   */
  private createDefaultExpertiseArea(): ExpertiseArea {
    return {
      name: 'default',
      description: 'Default expertise area with basic validation',
      version: '1.0.0',
      entityTypes: ['*'], // Accept all entity types
      relationTypes: ['*'], // Accept all relation types
      observationPatterns: ['*'], // Accept all observation patterns
      validationRules: [
        {
          name: 'basic_entity_validation',
          description: 'Basic validation for entities',
          validator: (entity: any) => {
            const errors: string[] = [];
            
            if (!entity.name || typeof entity.name !== 'string') {
              errors.push('Entity must have a valid name');
            }
            
            if (!entity.entityType || typeof entity.entityType !== 'string') {
              errors.push('Entity must have a valid entityType');
            }
            
            if (!Array.isArray(entity.observations)) {
              errors.push('Entity must have observations array');
            }
            
            return {
              isValid: errors.length === 0,
              errors: errors.length > 0 ? errors : undefined
            };
          }
        }
      ],
      semanticContext: {
        synonyms: {},
        relatedConcepts: {},
        hierarchies: {},
        constraints: {}
      },
      config: {
        strictValidation: false,
        autoEnrichment: false,
        conflictResolution: 'permissive'
      }
    };
  }

  /**
   * Initialize built-in expertise areas
   */
  private initializeBuiltInAreas(): void {
    // Software Development expertise area
    this.registerExpertiseArea({
      name: 'software_development',
      description: 'Software development and engineering domain',
      version: '1.0.0',
      entityTypes: [
        'project', 'component', 'module', 'class', 'function', 'variable',
        'bug', 'feature', 'requirement', 'test', 'developer', 'team',
        'repository', 'branch', 'commit', 'pull_request', 'issue'
      ],
      relationTypes: [
        'depends_on', 'implements', 'extends', 'uses', 'calls', 'imports',
        'fixes', 'breaks', 'tests', 'assigned_to', 'created_by', 'reviewed_by',
        'belongs_to', 'contains', 'part_of', 'related_to'
      ],
      observationPatterns: [
        'code_quality', 'performance_metrics', 'test_coverage', 'complexity',
        'documentation', 'security_issues', 'technical_debt', 'best_practices'
      ],
      validationRules: [
        {
          name: 'software_entity_validation',
          description: 'Validation specific to software entities',
          validator: (entity: any) => {
            const warnings: string[] = [];
            const suggestions: string[] = [];
            
            // Check for common software development patterns
            if (entity.entityType === 'bug' && !entity.observations.some((obs: string) => 
              obs.toLowerCase().includes('severity') || obs.toLowerCase().includes('priority'))) {
              warnings.push('Bug entities should include severity or priority information');
              suggestions.push('Add severity level (low/medium/high/critical) to observations');
            }
            
            if (entity.entityType === 'feature' && !entity.observations.some((obs: string) => 
              obs.toLowerCase().includes('requirement') || obs.toLowerCase().includes('spec'))) {
              suggestions.push('Consider adding requirement or specification details');
            }
            
            return {
              isValid: true,
              warnings: warnings.length > 0 ? warnings : undefined,
              suggestions: suggestions.length > 0 ? suggestions : undefined
            };
          }
        }
      ],
      semanticContext: {
        synonyms: {
          'bug': ['defect', 'issue', 'error', 'fault'],
          'feature': ['functionality', 'capability', 'enhancement'],
          'developer': ['programmer', 'engineer', 'coder'],
          'repository': ['repo', 'codebase', 'source']
        },
        relatedConcepts: {
          'bug': ['test', 'fix', 'regression', 'quality'],
          'feature': ['requirement', 'specification', 'user_story'],
          'project': ['team', 'repository', 'deployment', 'architecture']
        },
        hierarchies: {
          'project': ['component', 'module', 'class', 'function'],
          'team': ['developer', 'lead', 'manager'],
          'repository': ['branch', 'commit', 'pull_request']
        },
        constraints: {
          'bug_severity': ['low', 'medium', 'high', 'critical'],
          'feature_priority': ['low', 'medium', 'high', 'urgent']
        }
      },
      config: {
        strictValidation: false,
        autoEnrichment: true,
        conflictResolution: 'merge'
      },
      hooks: {
        beforeEntityCreate: (entity: any, context: KnowledgeContext) => {
          // Add project context if available
          if (context.project && !entity.observations.some((obs: string) => 
            obs.includes('project:'))) {
            entity.observations.push(`project: ${context.project}`);
          }
          return entity;
        }
      }
    });

    // Medical/Healthcare expertise area
    this.registerExpertiseArea({
      name: 'medical',
      description: 'Medical and healthcare domain',
      version: '1.0.0',
      entityTypes: [
        'patient', 'condition', 'symptom', 'treatment', 'medication', 'procedure',
        'doctor', 'nurse', 'specialist', 'hospital', 'clinic', 'lab_result',
        'diagnosis', 'prescription', 'appointment', 'medical_record'
      ],
      relationTypes: [
        'diagnosed_with', 'treated_by', 'prescribed', 'administered',
        'contraindicated_with', 'interacts_with', 'causes', 'alleviates',
        'referred_to', 'consulted_with', 'tested_for', 'resulted_in'
      ],
      observationPatterns: [
        'symptoms', 'vital_signs', 'lab_results', 'treatment_response',
        'side_effects', 'medical_history', 'allergies', 'medications'
      ],
      validationRules: [
        {
          name: 'medical_privacy_validation',
          description: 'Ensure medical entities comply with privacy requirements',
          validator: (entity: any) => {
            const warnings: string[] = [];
            
            // Check for potential PII in medical entities
            if (entity.entityType === 'patient') {
              const hasPersonalInfo = entity.observations.some((obs: string) => 
                /\b\d{3}-\d{2}-\d{4}\b/.test(obs) || // SSN pattern
                /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/.test(obs) // Email pattern
              );
              
              if (hasPersonalInfo) {
                warnings.push('Patient entity may contain personally identifiable information');
              }
            }
            
            return {
              isValid: true,
              warnings: warnings.length > 0 ? warnings : undefined
            };
          }
        }
      ],
      semanticContext: {
        synonyms: {
          'condition': ['disease', 'disorder', 'illness', 'ailment'],
          'medication': ['drug', 'medicine', 'pharmaceutical', 'treatment'],
          'doctor': ['physician', 'practitioner', 'clinician']
        },
        relatedConcepts: {
          'condition': ['symptom', 'treatment', 'diagnosis', 'prognosis'],
          'medication': ['dosage', 'side_effects', 'interactions', 'contraindications'],
          'patient': ['medical_history', 'allergies', 'vital_signs', 'lab_results']
        },
        hierarchies: {
          'hospital': ['department', 'ward', 'room'],
          'medical_staff': ['doctor', 'nurse', 'specialist', 'technician']
        },
        constraints: {
          'urgency_levels': ['routine', 'urgent', 'emergency', 'critical']
        }
      },
      config: {
        strictValidation: true,
        autoEnrichment: true,
        conflictResolution: 'strict'
      }
    });

    // Business/Enterprise expertise area
    this.registerExpertiseArea({
      name: 'business',
      description: 'Business and enterprise domain',
      version: '1.0.0',
      entityTypes: [
        'company', 'department', 'employee', 'customer', 'product', 'service',
        'project', 'contract', 'meeting', 'decision', 'strategy', 'goal',
        'kpi', 'budget', 'revenue', 'expense', 'market', 'competitor'
      ],
      relationTypes: [
        'works_for', 'manages', 'reports_to', 'collaborates_with', 'competes_with',
        'supplies', 'purchases', 'partners_with', 'owns', 'invests_in',
        'depends_on', 'influences', 'measures', 'targets'
      ],
      observationPatterns: [
        'performance_metrics', 'financial_data', 'market_analysis', 'customer_feedback',
        'strategic_objectives', 'operational_data', 'compliance_requirements'
      ],
      validationRules: [
        {
          name: 'business_entity_validation',
          description: 'Business-specific validation rules',
          validator: (entity: any) => {
            const suggestions: string[] = [];
            
            if (entity.entityType === 'kpi' && !entity.observations.some((obs: string) => 
              obs.toLowerCase().includes('target') || obs.toLowerCase().includes('goal'))) {
              suggestions.push('KPI entities should include target or goal information');
            }
            
            return {
              isValid: true,
              suggestions: suggestions.length > 0 ? suggestions : undefined
            };
          }
        }
      ],
      semanticContext: {
        synonyms: {
          'employee': ['staff', 'worker', 'team_member', 'personnel'],
          'customer': ['client', 'consumer', 'buyer', 'user'],
          'company': ['organization', 'corporation', 'business', 'enterprise']
        },
        relatedConcepts: {
          'kpi': ['metric', 'target', 'performance', 'measurement'],
          'project': ['timeline', 'budget', 'resources', 'deliverables'],
          'customer': ['satisfaction', 'retention', 'acquisition', 'lifetime_value']
        },
        hierarchies: {
          'company': ['division', 'department', 'team', 'employee'],
          'product': ['feature', 'component', 'version', 'variant']
        },
        constraints: {
          'priority_levels': ['low', 'medium', 'high', 'critical'],
          'project_status': ['planning', 'active', 'on_hold', 'completed', 'cancelled']
        }
      },
      config: {
        strictValidation: false,
        autoEnrichment: true,
        conflictResolution: 'merge'
      }
    });
  }
}

// Export singleton instance
export const expertiseAreaManager = new ExpertiseAreaManager();
