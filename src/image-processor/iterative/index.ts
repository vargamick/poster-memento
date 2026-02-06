/**
 * Iterative Processing Module
 *
 * Exports for the iterative poster processing pipeline.
 */

// Main processor
export { IterativeProcessor, createIterativeProcessor, IterativeProcessorDependencies } from './IterativeProcessor.js';

// Phase manager
export { PhaseManager } from './PhaseManager.js';

// Individual phases
export {
  BasePhase,
  PhaseInput,
  TypePhase,
  ArtistPhase,
  VenuePhase,
  EventPhase,
} from './phases/index.js';

// Prompts
export {
  TYPE_CLASSIFICATION_PROMPT,
  TYPE_REFINEMENT_PROMPT,
  ARTIST_PROMPTS,
  VENUE_PROMPTS,
  EVENT_PROMPTS,
  getPhasePrompt,
  getRefinementPrompt,
  getCombinedExtractionPrompt,
} from './prompts.js';

// Types
export * from './types.js';
