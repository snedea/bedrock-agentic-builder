# Troubleshooting

## Common Issues

### 1. CDK Bootstrap Fails

**Error**: `Unable to resolve AWS account`

**Solution**:
```bash
aws configure
# Enter credentials
./scripts/bootstrap.sh
```

### 2. Docker Build Fails

**Error**: `Cannot connect to Docker daemon`

**Solution**:
- Start Docker Desktop
- Run `docker ps` to verify

### 3. ECR Push Access Denied

**Error**: `denied: User is not authorized`

**Solution**:
```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com
```

### 4. Bedrock Access Denied

**Error**: `An error occurred (AccessDeniedException) when calling the InvokeModel operation`

**Solution**:
- Request model access in Bedrock Console
- Wait 5-10 minutes for approval
- Retry

### 5. Lambda Out of Memory

**Error**: `Task timed out after 300 seconds`

**Solution**:
- Increase Lambda timeout in CDK stack (max 15 min)
- Increase memory (512MB → 1024MB)

### 6. ECS Task Fails to Start

**Error**: `CannotPullContainerError`

**Solution**:
- Verify ECR image exists: `aws ecr describe-images --repository-name bedrock-code-executor`
- Check task execution role has ECR permissions

### 7. API Gateway 403 Forbidden

**Error**: `Missing Authentication Token`

**Solution**:
- Verify API endpoint is correct
- Check API Gateway stage is deployed

### 8. GitHub Deployment Fails

**Error**: `Failed to retrieve GitHub token`

**Solution**:
```bash
aws secretsmanager create-secret \
  --name bedrock-builder/github-token \
  --secret-string "your-github-pat"
```

## Debugging Tips

### View Lambda Logs

```bash
aws logs tail /aws/lambda/bedrock-builder-scout --follow
```

### Check ECS Task Logs

```bash
aws logs tail /ecs/bedrock-builder/code-executor --follow
```

### Inspect DynamoDB State

```bash
aws dynamodb scan --table-name bedrock-builder-state
```

### Check S3 Artifacts

```bash
aws s3 ls s3://bedrock-builder-artifacts-<account-id>/<build-id>/
```

## Getting Help

1. Check CloudWatch Logs for detailed errors
2. Review GitHub Issues: https://github.com/snedea/bedrock-agentic-builder/issues
3. AWS Bedrock documentation: https://docs.aws.amazon.com/bedrock/
