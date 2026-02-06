#!/bin/bash
# Reprocess poster images
# This script deletes existing poster data and reprocesses images from scratch

set -e

API_URL="http://localhost:3030/api/v1"
API_KEY="posters-api-key-2024"
BATCH_SIZE=10
MAX_IMAGES=100

echo "============================================"
echo "Poster Reprocessing Script"
echo "============================================"
echo "Batch size: $BATCH_SIZE"
echo "Max images: $MAX_IMAGES"
echo ""

# Function to make API calls
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3

    if [ -z "$data" ]; then
        curl -s -X "$method" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" "${API_URL}${endpoint}"
    else
        curl -s -X "$method" -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d "$data" "${API_URL}${endpoint}"
    fi
}

# Step 1: Get current poster count
echo "Step 1: Checking existing poster entities..."
EXISTING_COUNT=$(api_call GET "/entities?entityTypes=Poster&limit=1" | jq -r '.pagination.total // 0')
echo "Found $EXISTING_COUNT existing poster entities"

# Step 2: Delete existing poster entities
if [ "$EXISTING_COUNT" -gt 0 ]; then
    echo ""
    echo "Step 2: Deleting existing poster entities..."

    # Get all poster entity names
    POSTERS=$(api_call GET "/entities?entityTypes=Poster&limit=500" | jq -r '.data.entities[].name')

    DELETE_COUNT=0
    for poster_name in $POSTERS; do
        if [ ! -z "$poster_name" ]; then
            result=$(api_call DELETE "/entities/$poster_name")
            if echo "$result" | jq -e '.data.success // .success' > /dev/null 2>&1; then
                DELETE_COUNT=$((DELETE_COUNT + 1))
            fi
        fi
    done
    echo "Deleted $DELETE_COUNT poster entities"
else
    echo "No existing poster entities to delete"
fi

# Step 3: Reset processing state
echo ""
echo "Step 3: Resetting processing state..."
api_call POST "/posters/process/reset" "{}" | jq -r '.data.message // "Reset complete"'

# Step 4: Process images in batches
echo ""
echo "Step 4: Processing $MAX_IMAGES images in batches of $BATCH_SIZE..."
echo ""

PROCESSED=0
SUCCEEDED=0
FAILED=0
OFFSET=0

while [ $PROCESSED -lt $MAX_IMAGES ]; do
    # Calculate remaining to stay within MAX_IMAGES
    REMAINING=$((MAX_IMAGES - PROCESSED))
    CURRENT_BATCH=$BATCH_SIZE
    if [ $REMAINING -lt $BATCH_SIZE ]; then
        CURRENT_BATCH=$REMAINING
    fi

    BATCH_NUM=$((OFFSET / BATCH_SIZE + 1))
    echo "Batch $BATCH_NUM: Processing images $((OFFSET + 1))-$((OFFSET + CURRENT_BATCH))..."

    # Process batch
    RESULT=$(api_call POST "/posters/process" "{\"batchSize\": $CURRENT_BATCH, \"offset\": $OFFSET, \"skipIfExists\": false, \"storeImages\": true}")

    # Parse results
    BATCH_PROCESSED=$(echo "$RESULT" | jq -r '.data.processed // 0')
    BATCH_SUCCEEDED=$(echo "$RESULT" | jq -r '.data.succeeded // 0')
    BATCH_FAILED=$(echo "$RESULT" | jq -r '.data.failed // 0')
    BATCH_SKIPPED=$(echo "$RESULT" | jq -r '.data.skipped // 0')
    HAS_MORE=$(echo "$RESULT" | jq -r '.data.hasMore // false')
    AVG_TIME=$(echo "$RESULT" | jq -r '.data.averageProcessingTimeMs // 0')

    # Update totals
    PROCESSED=$((PROCESSED + BATCH_PROCESSED))
    SUCCEEDED=$((SUCCEEDED + BATCH_SUCCEEDED))
    FAILED=$((FAILED + BATCH_FAILED))

    # Show batch results
    echo "  Processed: $BATCH_PROCESSED, Succeeded: $BATCH_SUCCEEDED, Failed: $BATCH_FAILED, Skipped: $BATCH_SKIPPED"
    echo "  Average time: ${AVG_TIME}ms per image"

    # List individual results
    echo "$RESULT" | jq -r '.data.entities[]? | "  - \(.name): \(if .success then "✓" else "✗ \(.error)" end)"' 2>/dev/null || true
    echo ""

    # Update offset for next batch
    OFFSET=$((OFFSET + BATCH_PROCESSED))

    # Check if we're done
    if [ "$HAS_MORE" = "false" ] || [ $BATCH_PROCESSED -eq 0 ]; then
        break
    fi
done

# Step 5: Summary
echo "============================================"
echo "Processing Complete"
echo "============================================"
echo "Total processed: $PROCESSED"
echo "Succeeded: $SUCCEEDED"
echo "Failed: $FAILED"
echo ""

# Step 6: Verify results
echo "Step 6: Verifying results..."
FINAL_COUNT=$(api_call GET "/entities?entityTypes=Poster&limit=1" | jq -r '.pagination.total // 0')
echo "Total poster entities in database: $FINAL_COUNT"

# Show sample of type classifications
echo ""
echo "Sample type classifications:"
api_call GET "/entities?entityTypes=Poster&limit=10" | jq -r '.data.entities[] |
  (.observations[] | select(startswith("Poster type:")) | .) as $type |
  "\(.name): \($type)"' 2>/dev/null | head -10 || echo "No type data found"

echo ""
echo "Done!"
