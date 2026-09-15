# AWS serverless deployment

This is the low-cost target architecture for the real app:

- `serverless.yml` creates API Gateway, Lambda, Cognito, DynamoDB and private S3.
- DynamoDB uses on-demand billing, so idle usage has no provisioned-capacity charge.
- Originals stay private; the application must issue short-lived presigned URLs.
- No SES, email notifications or custom domain are required in v1.

Deploy from `infra/` with AWS SAM after the Lambda handlers are migrated:

```bash
sam build --template-file serverless.yml
sam deploy --guided --template-file .aws-sam/build/template.yaml
```

Before production, set an AWS Budget alarm and keep CloudTrail/audit retention limited to the required period.
