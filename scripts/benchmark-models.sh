#!/bin/bash
# Vision Model Benchmark Script
# Compares 3 local Ollama models against ground truth from Knowledge Graph

set -e

API_URL="http://localhost:3030/api/v1/posters/preview"
API_KEY="posters-api-key-2024"
BENCHMARK_FILE="/tmp/benchmark_posters.json"
RESULTS_FILE="/tmp/benchmark_results.json"

# Models to test
MODELS=("minicpm-v-ollama" "llama-vision-ollama" "llava-13b-ollama")

echo "============================================"
echo "Vision Model Benchmark"
echo "============================================"
echo "Testing ${#MODELS[@]} models against 20 ground truth posters"
echo ""

# Initialize results array
echo "[]" > "$RESULTS_FILE"

# Get count of test posters
POSTER_COUNT=$(jq 'length' "$BENCHMARK_FILE")
echo "Ground truth posters: $POSTER_COUNT"
echo ""

# Process each poster
POSTER_INDEX=0
while [ $POSTER_INDEX -lt $POSTER_COUNT ]; do
  # Get ground truth for this poster
  POSTER=$(jq ".[$POSTER_INDEX]" "$BENCHMARK_FILE")
  IMAGE=$(echo "$POSTER" | jq -r '.image')
  GT_TYPE=$(echo "$POSTER" | jq -r '.type')
  GT_TITLE=$(echo "$POSTER" | jq -r '.title')

  echo "[$((POSTER_INDEX + 1))/$POSTER_COUNT] $IMAGE (expected: $GT_TYPE)"

  # Initialize result object for this poster
  POSTER_RESULT=$(echo "{}" | jq --arg img "$IMAGE" --arg gt_type "$GT_TYPE" --arg gt_title "$GT_TITLE" \
    '. + {image: $img, ground_truth: {type: $gt_type, title: $gt_title}, results: {}}')

  # Test each model
  for MODEL in "${MODELS[@]}"; do
    echo "  Testing $MODEL..."

    # Call preview API
    RESPONSE=$(curl -s -X POST \
      -H "X-API-Key: $API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"imagePath\": \"/app/source-images/$IMAGE\", \"modelKey\": \"$MODEL\"}" \
      "$API_URL" 2>/dev/null || echo '{"data":{"success":false,"error":"Request failed"}}')

    # Extract results
    MODEL_TYPE=$(echo "$RESPONSE" | jq -r '.data.entity.poster_type // "error"')
    MODEL_TITLE=$(echo "$RESPONSE" | jq -r '.data.entity.title // "N/A"')
    TIME_MS=$(echo "$RESPONSE" | jq -r '.data.processingTimeMs // 0')
    SUCCESS=$(echo "$RESPONSE" | jq -r '.data.success // false')

    # Check if type matches
    TYPE_MATCH="false"
    if [ "$MODEL_TYPE" = "$GT_TYPE" ]; then
      TYPE_MATCH="true"
      echo "    ✓ Type: $MODEL_TYPE (${TIME_MS}ms)"
    else
      echo "    ✗ Type: $MODEL_TYPE (expected: $GT_TYPE) (${TIME_MS}ms)"
    fi

    # Add model result to poster result
    POSTER_RESULT=$(echo "$POSTER_RESULT" | jq --arg model "$MODEL" \
      --arg type "$MODEL_TYPE" \
      --arg title "$MODEL_TITLE" \
      --argjson time "$TIME_MS" \
      --argjson match "$TYPE_MATCH" \
      --argjson success "$SUCCESS" \
      '.results[$model] = {type: $type, title: $title, time_ms: $time, type_match: $match, success: $success}')
  done

  # Append poster result to results file
  jq --argjson result "$POSTER_RESULT" '. += [$result]' "$RESULTS_FILE" > /tmp/results_tmp.json
  mv /tmp/results_tmp.json "$RESULTS_FILE"

  echo ""
  POSTER_INDEX=$((POSTER_INDEX + 1))
done

echo "============================================"
echo "BENCHMARK SUMMARY"
echo "============================================"

# Calculate accuracy for each model
for MODEL in "${MODELS[@]}"; do
  CORRECT=$(jq "[.[] | .results[\"$MODEL\"].type_match] | map(select(. == true)) | length" "$RESULTS_FILE")
  TOTAL=$(jq "length" "$RESULTS_FILE")
  AVG_TIME=$(jq "[.[] | .results[\"$MODEL\"].time_ms] | add / length | floor" "$RESULTS_FILE")
  ACCURACY=$(echo "scale=1; $CORRECT * 100 / $TOTAL" | bc)

  echo ""
  echo "$MODEL:"
  echo "  Accuracy: $CORRECT/$TOTAL ($ACCURACY%)"
  echo "  Avg Time: ${AVG_TIME}ms"
done

echo ""
echo "Detailed results saved to: $RESULTS_FILE"
echo ""

# Show type breakdown per model
echo "Type Classification Breakdown:"
echo "-----------------------------"
for MODEL in "${MODELS[@]}"; do
  echo ""
  echo "$MODEL:"
  jq -r "[.[] | {gt: .ground_truth.type, pred: .results[\"$MODEL\"].type}] | group_by(.gt) | .[] | \"  \(.[0].gt): \" + ([.[] | select(.gt == .pred)] | length | tostring) + \"/\" + (length | tostring)" "$RESULTS_FILE"
done
