#!/bin/bash
# Compare Vision Models for Poster Type Classification
# Tests multiple models on the same set of sample posters

set -e

API_URL="http://localhost:3030/api/v1"
API_KEY="posters-api-key-2024"

# Test images - choose ones that should have clear types
TEST_IMAGES=(
    "1200techniques.JPG"      # Should be: release (album)
    "12bent.JPG"              # Should be: festival
    "2046.JPG"                # Should be: film
    "20comedyfestival.JPG"    # Should be: comedy or festival
    "50cent.JPG"              # Should be: release or concert
)

echo "============================================"
echo "Vision Model Comparison Test"
echo "============================================"
echo ""

# Function to get available models
get_models() {
    curl -s -H "X-API-Key: $API_KEY" "${API_URL}/posters/models" | jq -r '.data.models[].key'
}

# Function to preview a poster with a specific model
preview_poster() {
    local image=$1
    local model=$2

    curl -s -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
        -d "{\"imagePath\": \"/app/source-images/${image}\", \"modelKey\": \"${model}\"}" \
        "${API_URL}/posters/preview"
}

# Get list of available models
echo "Checking available vision models..."
AVAILABLE_MODELS=$(get_models)
echo "Available models:"
echo "$AVAILABLE_MODELS" | while read model; do
    echo "  - $model"
done
echo ""

# Test each model
for MODEL in $AVAILABLE_MODELS; do
    echo "============================================"
    echo "Testing model: $MODEL"
    echo "============================================"

    for IMAGE in "${TEST_IMAGES[@]}"; do
        echo ""
        echo "Image: $IMAGE"

        RESULT=$(preview_poster "$IMAGE" "$MODEL" 2>/dev/null)

        if [ $? -eq 0 ] && [ ! -z "$RESULT" ]; then
            SUCCESS=$(echo "$RESULT" | jq -r '.data.success // false')

            if [ "$SUCCESS" = "true" ]; then
                TYPE=$(echo "$RESULT" | jq -r '.data.entity.poster_type // "unknown"')
                TITLE=$(echo "$RESULT" | jq -r '.data.entity.title // "N/A"' | head -c 50)
                HEADLINER=$(echo "$RESULT" | jq -r '.data.entity.headliner // "N/A"' | head -c 50)
                TIME=$(echo "$RESULT" | jq -r '.data.processingTimeMs // 0')

                echo "  Type: $TYPE"
                echo "  Title: $TITLE"
                echo "  Headliner: $HEADLINER"
                echo "  Processing time: ${TIME}ms"
            else
                ERROR=$(echo "$RESULT" | jq -r '.data.error // "Unknown error"')
                echo "  ERROR: $ERROR"
            fi
        else
            echo "  ERROR: Failed to get response from API"
        fi
    done

    echo ""
done

echo "============================================"
echo "Comparison Complete"
echo "============================================"
