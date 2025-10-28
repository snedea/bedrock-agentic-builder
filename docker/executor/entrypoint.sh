#!/bin/bash
set -e

echo "Code Executor starting..."
echo "Build ID: $BUILD_ID"

# Download artifacts from S3
echo "Downloading artifacts from S3..."
aws s3 sync s3://${ARTIFACTS_BUCKET}/${BUILD_ID}/ /workspace/

# Detect project type and install dependencies
if [ -f "package.json" ]; then
    echo "Node.js project detected, installing dependencies..."
    npm install
fi

if [ -f "requirements.txt" ]; then
    echo "Python project detected, installing dependencies..."
    pip install -r requirements.txt
fi

# Run tests
echo "Running tests..."
if [ -f "package.json" ] && grep -q '"test"' package.json; then
    npm test 2>&1 | tee test-output.log
    TEST_EXIT_CODE=${PIPESTATUS[0]}
elif [ -d "tests" ]; then
    pytest tests/ -v 2>&1 | tee test-output.log
    TEST_EXIT_CODE=${PIPESTATUS[0]}
else
    echo "No tests found" | tee test-output.log
    TEST_EXIT_CODE=0
fi

# Upload test results to S3
echo "Uploading test results..."
aws s3 cp test-output.log s3://${LOGS_BUCKET}/${BUILD_ID}/test-output.log

echo "Code executor finished with exit code: $TEST_EXIT_CODE"
exit $TEST_EXIT_CODE
