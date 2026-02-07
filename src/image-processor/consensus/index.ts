/**
 * Consensus Processing Module
 *
 * Multi-model "triple-keying" for improved poster data extraction accuracy.
 * Runs the same image through multiple vision models and merges results
 * using voting, union, and confidence-weighted strategies.
 */

export {
  ConsensusProcessor,
  ModelResult,
  FieldConsensus,
  ConsensusResult,
  ConsensusConfig,
} from './ConsensusProcessor.js';
