#!/bin/bash
set -e

echo "Running end-to-end test..."

# Get API endpoint from CDK outputs
API_URL=$(aws cloudformation describe-stacks \
  --stack-name BedrockBuilderApiStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text)

echo "API URL: $API_URL"

# Start a simple build
BUILD_RESPONSE=$(curl -s -X POST "${API_URL}build" \
  -H "Content-Type: application/json" \
  -d '{"task": "Build a simple Hello World Python script", "max_iterations": 1}')

echo "Build started: $BUILD_RESPONSE"

BUILD_ID=$(echo $BUILD_RESPONSE | jq -r '.build_id')

echo "Build ID: $BUILD_ID"
echo "Waiting for build to complete..."

# Poll for completion (max 5 minutes)
for i in {1..30}; do
  sleep 10
  STATUS_RESPONSE=$(curl -s "${API_URL}build/${BUILD_ID}")
  STATUS=$(echo $STATUS_RESPONSE | jq -r '.status')

  echo "Status: $STATUS"

  if [ "$STATUS" = "passed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi
done

echo "Final status: $STATUS"
echo "Full response:"
echo $STATUS_RESPONSE | jq .

if [ "$STATUS" = "passed" ]; then
  echo "✅ E2E test PASSED"
  exit 0
else
  echo "❌ E2E test FAILED"
  exit 1
fi
