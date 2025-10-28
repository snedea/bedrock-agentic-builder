# Bedrock Agentic Builder

> Autonomous software development infrastructure on AWS using Amazon Bedrock Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![AWS](https://img.shields.io/badge/AWS-Bedrock-orange)](https://aws.amazon.com/bedrock/)
[![CDK](https://img.shields.io/badge/CDK-TypeScript-blue)](https://aws.amazon.com/cdk/)

## Overview

Bedrock Agentic Builder is a production-ready AWS infrastructure that replicates Context Foundry's autonomous build capabilities using Amazon Bedrock Agents. The system orchestrates four specialist agents (Scout, Architect, Builder, Tester) to complete software development tasks end-to-end with self-healing capabilities.

## Features

✅ **Autonomous Workflow**: Scout → Architect → Builder → Test → Deploy
✅ **Self-Healing**: Automatic retry with fixes (up to 3 iterations)
✅ **AWS-Native**: Bedrock, Lambda, ECS Fargate, DynamoDB, S3
✅ **Scalable**: Serverless architecture with auto-scaling
✅ **Observable**: CloudWatch dashboards and alarms
✅ **Secure**: IAM least-privilege, Secrets Manager integration
✅ **Type-Safe**: TypeScript CDK infrastructure

## Architecture

```
API Gateway → Bedrock Agent (Orchestrator)
                 ├─→ Scout Lambda (Analyze requirements)
                 ├─→ Architect Lambda (Design system)
                 ├─→ Builder Lambda (Generate code)
                 └─→ Tester Lambda (Run tests in ECS Fargate)
                        ↓
            DynamoDB (State) + S3 (Artifacts) + GitHub (Deploy)
```

## Prerequisites

- AWS Account with Bedrock access (us-east-1 region recommended)
- AWS CLI configured with credentials
- Node.js 20+ and npm
- Docker (for building executor image)
- Python 3.11+ (for Lambda functions)
- CDK CLI: `npm install -g aws-cdk`

## Installation

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/snedea/bedrock-agentic-builder.git
cd bedrock-agentic-builder
npm install
cd cdk && npm install && cd ..
```

### 2. Bootstrap CDK

```bash
./scripts/bootstrap.sh
```

### 3. Deploy Infrastructure

```bash
./scripts/deploy.sh
```

This will:
- Build and push Docker image to ECR
- Deploy CDK stacks (Storage, ECS, Bedrock, API Gateway, Monitoring)
- Create DynamoDB tables, S3 buckets, Lambda functions, ECS cluster

### 4. Manual Configuration (Post-Deployment)

Due to CDK limitations with Bedrock Agent L1 constructs:

1. **Create Bedrock Agent** via AWS Console:
   - Use configuration from `bedrock/agent-config.json`
   - Attach the 4 action groups (Lambda ARNs from CDK outputs)
   - Upload OpenAPI schemas from `bedrock/action-groups/` to S3 KB bucket

2. **Create GitHub PAT Secret**:
   ```bash
   aws secretsmanager create-secret \
     --name bedrock-builder/github-token \
     --secret-string "your-github-pat"
   ```

3. **Update Subnet IDs**:
   - Edit `lambda/tester/handler.py` line 92
   - Replace `subnet-xxx` with your default VPC subnet IDs

## Usage

### Start a Build via API

```bash
API_URL=$(aws cloudformation describe-stacks \
  --stack-name BedrockBuilderApiStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text)

curl -X POST "${API_URL}build" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Build a REST API for a todo list in Python FastAPI",
    "mode": "new_project",
    "max_iterations": 3
  }'
```

### Check Build Status

```bash
curl "${API_URL}build/<build_id>"
```

### List All Builds

```bash
curl "${API_URL}builds?status=passed"
```

## Testing

### Unit Tests

```bash
npm run test:python  # Lambda function tests
npm run test         # CDK snapshot tests
```

### Integration Tests

```bash
npm run test:integration
```

### End-to-End Test

```bash
npm run test:e2e
```

## Project Structure

```
bedrock-agentic-builder/
├── cdk/                    # AWS CDK infrastructure (TypeScript)
│   ├── lib/               # Stack definitions
│   └── test/              # CDK tests
├── lambda/                # Lambda functions (Python 3.11)
│   ├── scout/            # Requirements analysis
│   ├── architect/        # Architecture design
│   ├── builder/          # Code generation
│   ├── tester/           # Testing & self-healing
│   └── shared/           # Common libraries
├── docker/executor/       # ECS Fargate test executor
├── bedrock/              # Bedrock Agent configurations
├── scripts/              # Deployment automation
├── tests/                # Integration & E2E tests
└── docs/                 # Documentation
```

## Cost Estimation

See [docs/COST_ESTIMATION.md](docs/COST_ESTIMATION.md) for detailed breakdown.

**Light usage (~10 builds/month)**: $30-50/month
- Bedrock API calls: ~$20
- Lambda: ~$5
- ECS Fargate: ~$10
- DynamoDB/S3: ~$5

## Documentation

- [Architecture Details](docs/ARCHITECTURE.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [API Reference](docs/API.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Monitoring

Access CloudWatch dashboard:
```bash
aws cloudformation describe-stacks \
  --stack-name BedrockBuilderMonitoringStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DashboardUrl`].OutputValue' \
  --output text
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feature/my-feature`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

🤖 Built autonomously by [Context Foundry](https://contextfoundry.dev)

Inspired by Context Foundry's autonomous build system, reimplemented on AWS Bedrock infrastructure.

## Support

- GitHub Issues: [Report bugs](https://github.com/snedea/bedrock-agentic-builder/issues)
- Documentation: [Full docs](docs/)
- AWS Support: [Bedrock documentation](https://docs.aws.amazon.com/bedrock/)
