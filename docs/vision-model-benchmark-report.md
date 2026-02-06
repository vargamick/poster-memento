# Vision Model Benchmark Report

**Date:** 2026-02-05
**Test Set:** 20 posters from Knowledge Graph with known types
**Models Tested:** minicpm-v, llama3.2-vision:11b, llava:13b

## Executive Summary

**Winner: minicpm-v-ollama** with 80% type classification accuracy

| Model | Accuracy | Avg Processing Time |
|-------|----------|---------------------|
| minicpm-v-ollama | **80%** (16/20) | 30.7s |
| llava-13b-ollama | 30% (6/20) | 28.4s |
| llama-vision-ollama | 0% (0/20) | 82.5s |

## Detailed Results

### Per-Type Accuracy

| Type | minicpm-v | llava-13b | llama-vision |
|------|-----------|-----------|--------------|
| comedy | **100%** (2/2) | 0% (0/2) | 0% (0/2) |
| concert | **83%** (5/6) | 0% (0/6) | 0% (0/6) |
| film | 75% (6/8) | **50%** (4/8) | 0% (0/8) |
| release | 50% (1/2) | **100%** (2/2) | 0% (0/2) |
| theater | **100%** (2/2) | 0% (0/2) | 0% (0/2) |

### Key Findings

1. **minicpm-v is the clear winner**
   - Best overall accuracy at 80%
   - Excellent at: comedy (100%), theater (100%), concert (83%)
   - Reasonable processing time (~31s average)

2. **llava-13b has complementary strengths**
   - Best at: release (100%), decent at film (50%)
   - Over-classifies as "release" (8 false positives for release type)
   - Fastest processing (~28s average)

3. **llama3.2-vision:11b is not suitable**
   - Returns "unknown" for all classifications
   - Very slow processing (~82s average)
   - Likely needs different prompt engineering or may not follow the prompt format

## Error Analysis

### minicpm-v Misclassifications (4 errors)
- `afractionofthewhole.JPG`: Expected release, got promo
- `ahistoryofviolence.JPG`: Expected film, got unknown
- `alkalinetrio.JPG`: Expected concert, got unknown
- `50cent2.JPG`: Expected film, got unknown

### llava-13b Pattern
- Tends to classify everything as "release" or "film"
- Misses concert, comedy, theater types entirely
- Good at actual release/film posters

## Recommendations

### Immediate Action
1. **Keep minicpm-v as default** - Already configured, 80% accuracy
2. **Fixed regex parsing bug** - Now correctly extracts types from "POSTER TYPE:\n- type" format

### Future Improvements
1. **Hybrid approach**: Use llava-13b for suspected release/film posters, minicpm-v for others
2. **QA Validation**: Implement the existing QA validation system to catch and correct misclassifications
3. **Prompt tuning**: Improve prompt for llama-vision to follow the expected output format
4. **Ensemble voting**: Run multiple models and use majority vote for higher confidence

### Processing Time Considerations
For batch processing 2148 images:
- minicpm-v: ~18.3 hours
- llava-13b: ~17.0 hours
- llama-vision: ~49.2 hours (not recommended)

## Technical Notes

### Bug Fix Applied
Updated regex in `OllamaVisionProvider.ts:164` to handle both output formats:
- Old: `POSTER TYPE: release`
- New: `POSTER TYPE:\n- release`

### Test Methodology
1. Queried Neo4j for 20 posters with known type classifications
2. Processed each image with all 3 models using `/api/v1/posters/preview`
3. Compared extracted type vs ground truth from Knowledge Graph
4. No changes committed to database during testing

## Appendix: Raw Results

Detailed results saved to: `/tmp/benchmark_results.json`

Ground truth dataset:
- 2 comedy, 6 concert, 8 film, 2 release, 2 theater
