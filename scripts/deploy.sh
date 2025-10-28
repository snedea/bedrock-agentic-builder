#!/bin/bash
set -e

echo "Deploying Bedrock Agentic Builder..."

# Check prerequisites
command -v aws >/dev/null 2>&1 || { echo "AWS CLI required but not installed."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm required but not installed."; exit 1; }

# Bootstrap CDK if needed
./scripts/bootstrap.sh

# Build Docker image and push to ECR
echo "Building Docker executor image..."
cd docker/executor
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-us-east-1}
ECR_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/bedrock-code-executor"

# Login to ECR
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_URI

# Build and push
docker build -t bedrock-code-executor:latest .
docker tag bedrock-code-executor:latest ${ECR_URI}:latest
docker push ${ECR_URI}:latest

cd ../..

# Deploy CDK stacks
echo "Deploying CDK stacks..."
cd cdk
npm install
npm run build
npm run deploy

echo "Deployment complete!"
echo "Next steps:"
echo "1. Create Bedrock Agent manually via AWS Console (CDK L1 constructs have limitations)"
echo "2. Upload OpenAPI schemas to S3 KB bucket"
echo "3. Create GitHub PAT secret in Secrets Manager"
echo "4. Test with: curl -X POST <API_URL>/build -d '{\"task\":\"Build hello world\"}'"
