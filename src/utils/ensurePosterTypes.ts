/**
 * Auto-seeding utility for PosterType entities
 *
 * Ensures PosterType entities exist before processing posters.
 * Called automatically at the start of the processing pipeline.
 */

import type { KnowledgeGraphManager } from '../KnowledgeGraphManager.js';
import { logger } from './logger.js';

/**
 * PosterType seed data - embedded to avoid file system dependencies
 */
const POSTER_TYPE_SEEDS = [
  {
    name: 'PosterType_concert',
    entityType: 'PosterType',
    type_key: 'concert',
    display_name: 'Concert',
    description: 'Single artist/band live performance at a venue',
    detection_hints: ['live', 'show', 'performance', 'tour', 'tickets', 'doors']
  },
  {
    name: 'PosterType_festival',
    entityType: 'PosterType',
    type_key: 'festival',
    display_name: 'Festival',
    description: 'Multi-act music festival',
    detection_hints: ['festival', 'fest', 'day 1', 'day 2', 'multiple stages', 'lineup']
  },
  {
    name: 'PosterType_comedy',
    entityType: 'PosterType',
    type_key: 'comedy',
    display_name: 'Comedy',
    description: 'Comedy show or standup performance',
    detection_hints: ['comedy', 'standup', 'stand-up', 'comedian', 'funny', 'laughs']
  },
  {
    name: 'PosterType_theater',
    entityType: 'PosterType',
    type_key: 'theater',
    display_name: 'Theater',
    description: 'Theatrical production or play',
    detection_hints: ['theater', 'theatre', 'play', 'musical', 'production', 'broadway']
  },
  {
    name: 'PosterType_film',
    entityType: 'PosterType',
    type_key: 'film',
    display_name: 'Film',
    description: 'Movie or film screening',
    detection_hints: ['film', 'movie', 'cinema', 'screening', 'premiere', 'directed by']
  },
  {
    name: 'PosterType_album',
    entityType: 'PosterType',
    type_key: 'album',
    display_name: 'Album',
    description: 'Album, single, EP, or music release promo',
    detection_hints: ['album', 'out now', 'new release', 'available', 'streaming', 'pre-order', 'tracklist']
  },
  {
    name: 'PosterType_promo',
    entityType: 'PosterType',
    type_key: 'promo',
    display_name: 'Promo',
    description: 'General promotional/advertising',
    detection_hints: ['promo', 'advertisement', 'sponsored', 'brand']
  },
  {
    name: 'PosterType_exhibition',
    entityType: 'PosterType',
    type_key: 'exhibition',
    display_name: 'Exhibition',
    description: 'Art exhibition, gallery, or museum',
    detection_hints: ['exhibition', 'gallery', 'museum', 'art show', 'exhibit', 'opening']
  },
  {
    name: 'PosterType_unknown',
    entityType: 'PosterType',
    type_key: 'unknown',
    display_name: 'Unknown',
    description: 'Type could not be determined',
    detection_hints: []
  }
] as const;

// Cache to avoid repeated checks within the same session
let posterTypesSeeded = false;

/**
 * Ensures PosterType entities exist in the knowledge graph.
 * Creates them if they don't exist. Safe to call multiple times.
 *
 * @param knowledgeGraphManager - The knowledge graph manager instance
 * @returns Promise<{ created: number; existing: number }>
 */
export async function ensurePosterTypesSeeded(
  knowledgeGraphManager: KnowledgeGraphManager
): Promise<{ created: number; existing: number }> {
  // Quick exit if already seeded this session
  if (posterTypesSeeded) {
    return { created: 0, existing: POSTER_TYPE_SEEDS.length };
  }

  logger.debug('Checking for PosterType entities...');

  try {
    // Check for existing PosterType entities
    const existingGraph = await knowledgeGraphManager.readGraph({
      limit: 100,
      includeTotalCount: false,
      entityTypes: ['PosterType']
    });

    const existingPosterTypes = existingGraph.entities;
    const existingNames = new Set(existingPosterTypes.map(e => e.name));

    // Find which types need to be created
    const typesToCreate = POSTER_TYPE_SEEDS.filter(
      seed => !existingNames.has(seed.name)
    );

    if (typesToCreate.length === 0) {
      logger.debug(`All ${POSTER_TYPE_SEEDS.length} PosterType entities already exist`);
      posterTypesSeeded = true;
      return { created: 0, existing: existingPosterTypes.length };
    }

    logger.info(`Creating ${typesToCreate.length} missing PosterType entities...`);

    // Convert seed data to Entity format
    const entities = typesToCreate.map(seed => ({
      name: seed.name,
      entityType: seed.entityType,
      observations: [
        `Type key: ${seed.type_key}`,
        `Display name: ${seed.display_name}`,
        `Description: ${seed.description}`,
        seed.detection_hints.length > 0
          ? `Detection hints: ${seed.detection_hints.join(', ')}`
          : 'No detection hints'
      ],
      type_key: seed.type_key,
      display_name: seed.display_name,
      description: seed.description,
      detection_hints: seed.detection_hints
    }));

    // Create entities
    const created = await knowledgeGraphManager.createEntities(entities as any);

    logger.info(`Created ${created.length} PosterType entities`);
    posterTypesSeeded = true;

    return {
      created: created.length,
      existing: existingPosterTypes.length
    };
  } catch (error) {
    logger.error('Failed to seed PosterType entities:', error);
    throw error;
  }
}

/**
 * Reset the seeding cache (useful for testing or after database clear)
 */
export function resetPosterTypeSeedCache(): void {
  posterTypesSeeded = false;
}

/**
 * Get the list of valid poster type keys
 */
export function getValidPosterTypeKeys(): string[] {
  return POSTER_TYPE_SEEDS.map(seed => seed.type_key);
}
