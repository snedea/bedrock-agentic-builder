# Architecture Documentation

For detailed architecture information, see the main architecture document in `.context-foundry/architecture.md`.

## High-Level Overview

The Bedrock Agentic Builder uses a serverless architecture on AWS:

1. **API Gateway**: REST API for external access
2. **Bedrock Agent**: Orchestrates the workflow
3. **Lambda Functions**: Four specialist agents (Scout, Architect, Builder, Tester)
4. **ECS Fargate**: Isolated test execution environment
5. **DynamoDB**: Build state management
6. **S3**: Artifact and log storage
7. **CloudWatch**: Monitoring and observability

## Workflow

```
User Request → API Gateway
    ↓
Bedrock Agent (Orchestrator)
    ↓
Scout Lambda → Analyze requirements → Save to DynamoDB
    ↓
Architect Lambda → Design system → Save to DynamoDB
    ↓
Builder Lambda → Generate code → Upload to S3
    ↓
Tester Lambda → Trigger ECS Fargate → Run tests
    ↓
    ├─→ Tests Pass → Deploy to GitHub → Done
    └─→ Tests Fail → Check iterations
            ├─→ < Max → Increment → Back to Architect (Self-Healing)
            └─→ >= Max → Mark Failed → Done
```

## Self-Healing Loop

The system automatically fixes test failures:

1. Tester runs tests in isolated Fargate environment
2. If tests fail, Bedrock analyzes the output
3. Recommendations are passed back to Architect
4. Architect redesigns the failing parts
5. Builder regenerates the code
6. Loop repeats up to `max_iterations` (default 3)

## Security

- IAM least-privilege roles for each component
- Secrets Manager for GitHub PAT
- VPC isolation for Fargate tasks (optional)
- No hardcoded credentials
- S3 buckets with encryption and block public access
- CloudWatch logs for audit trail

## Scalability

- API Gateway: Handles 10,000 requests/second
- Lambda: Auto-scales to 1,000 concurrent executions
- ECS Fargate: Scales based on task demand
- DynamoDB: On-demand pricing, auto-scales
- S3: Unlimited storage, scales automatically

## Observability

- CloudWatch Dashboard with all metrics
- Lambda execution logs
- ECS task logs
- DynamoDB query metrics
- Alarms for errors and throttles
