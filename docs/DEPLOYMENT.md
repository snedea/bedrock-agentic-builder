# Deployment Guide

## Prerequisites

1. AWS account with Bedrock model access (request Claude Sonnet access if needed)
2. AWS CLI configured: `aws configure`
3. Node.js 20+, npm, Python 3.11+, Docker installed
4. CDK CLI: `npm install -g aws-cdk`

## Step-by-Step Deployment

### 1. Bootstrap CDK (First Time Only)

```bash
./scripts/bootstrap.sh
```

### 2. Deploy All Stacks

```bash
./scripts/deploy.sh
```

Wait 10-15 minutes for deployment to complete.

### 3. Create Bedrock Agent (Manual)

CDK doesn't support Bedrock Agent L2 constructs yet, so create manually:

1. Open AWS Console → Amazon Bedrock → Agents
2. Click "Create Agent"
3. Name: `BedrockAgenticBuilder`
4. Model: `anthropic.claude-3-5-sonnet-20241022-v2:0`
5. Instructions: Copy from `bedrock/agent-config.json`
6. Add 4 action groups:
   - Scout: Lambda ARN from stack output `ScoutFunctionArn`
   - Architect: Lambda ARN from `ArchitectFunctionArn`
   - Builder: Lambda ARN from `BuilderFunctionArn`
   - Tester: Lambda ARN from `TesterFunctionArn`
7. Upload OpenAPI schemas from `bedrock/action-groups/*.yaml` to KB bucket
8. Create alias: `prod`

### 4. Configure Secrets

```bash
aws secretsmanager create-secret \
  --name bedrock-builder/github-token \
  --secret-string "ghp_your_token_here"
```

### 5. Verify Deployment

```bash
npm run test:e2e
```

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
