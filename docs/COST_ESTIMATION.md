# Cost Estimation

## Monthly Costs (Light Usage: ~10 builds/month)

### Bedrock API Calls
- Scout analysis: ~5,000 tokens/build = 50K tokens/month
- Architect design: ~8,000 tokens/build = 80K tokens/month
- Builder code gen: ~15,000 tokens/build = 150K tokens/month
- Tester analysis: ~3,000 tokens/build = 30K tokens/month
- **Total**: 310K tokens/month × $0.003/1K = **$0.93** (input)
- Output tokens: ~200K/month × $0.015/1K = **$3.00**
- **Bedrock subtotal**: ~$20/month (with iterations)

### Lambda
- Invocations: 40/month (4 per build × 10 builds)
- Duration: 2 minutes avg × 512MB = 60,000 MB-seconds/month
- **Cost**: < $1/month (within free tier)

### ECS Fargate
- Task runs: 10-30/month (1-3 per build for testing)
- Duration: 5 minutes avg × 1 vCPU + 2GB = 150 vCPU-minutes/month
- **Cost**: 150 min × $0.04048/vCPU-hour ÷ 60 = **$0.10/vCPU**
- **Cost**: 150 min × $0.004445/GB-hour × 2GB ÷ 60 = **$0.02/memory**
- **ECS subtotal**: ~$10/month

### DynamoDB
- Reads/Writes: ~500/month
- Storage: < 1GB
- **Cost**: On-demand pricing = < $1/month

### S3
- Storage: ~5GB (artifacts + logs)
- Requests: ~1,000/month
- **Cost**: $0.12 + $0.01 = **$0.13/month**

### ECR
- Storage: ~500MB (Docker image)
- **Cost**: $0.05/month

### Data Transfer
- Minimal (< 1GB/month)
- **Cost**: < $0.10/month

## Total Estimate

**Light usage (10 builds/month)**: **$30-40/month**

**Medium usage (50 builds/month)**: **$100-150/month**

**Heavy usage (200 builds/month)**: **$400-500/month**

## Cost Optimization Tips

1. **Delete old artifacts**: S3 lifecycle policies auto-delete after 30 days
2. **Use smaller tasks**: Split large builds to reduce Bedrock token usage
3. **Limit iterations**: Set `max_iterations: 2` instead of 3
4. **Use caching**: Cache common patterns to reduce redundant Bedrock calls
5. **Monitor usage**: Set CloudWatch billing alarms

## Free Tier Eligibility

- Lambda: 1M requests + 400K GB-seconds/month (永久 free tier)
- DynamoDB: 25 read/write units/second (永久 free tier)
- S3: 5GB storage (first 12 months)

**Effective cost for first year with free tier**: **$25-30/month** for light usage
