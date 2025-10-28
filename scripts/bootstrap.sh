#!/bin/bash
set -e

REGION=${AWS_REGION:-us-east-1}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

echo "Checking CDK bootstrap status..."

# Check if already bootstrapped
if aws cloudformation describe-stacks --stack-name CDKToolkit --region $REGION >/dev/null 2>&1; then
    echo "CDK already bootstrapped in region $REGION"
else
    echo "Bootstrapping CDK in region $REGION..."
    cd cdk
    npx cdk bootstrap aws://$ACCOUNT/$REGION
    cd ..
    echo "CDK bootstrap complete"
fi
