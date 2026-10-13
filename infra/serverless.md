# AWS serverless deployment

Low-cost architecture used by the live site (`docs/` + `lambda/`):

- `serverless.yml`: HTTP API, one Lambda, Cognito, DynamoDB (on-demand), private S3.
- Idle cost is close to zero: no provisioned capacity, no servers.
- Originals stay private; clients only get short-lived presigned URLs.

## Releasing

Push to branch `client-gallery`. `.github/workflows/release.yml` assumes the
`AWS_ROLE_ARN` role (GitHub OIDC), runs `sam build` + `sam deploy` for stack
`pixiset-gallery` in `us-east-1`, then publishes `docs/` to GitHub Pages.

The role has `PowerUserAccess`, which cannot create or change IAM roles. Do not add
new IAM resources or Lambda policies to the template; deploy those once by hand with
an administrator.

## Preview a change before pushing

```bash
aws cloudformation package --template-file infra/serverless.yml \
  --s3-bucket pixiset-deploy-<account>-us-east-1 --s3-prefix preview \
  --output-template-file packaged.yml --region us-east-1
aws cloudformation create-change-set --stack-name pixiset-gallery \
  --change-set-name preview --template-body file://packaged.yml \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND \
  --parameters ParameterKey=AppVersion,ParameterValue=preview --region us-east-1
aws cloudformation describe-change-set --stack-name pixiset-gallery --change-set-name preview --region us-east-1
aws cloudformation delete-change-set --stack-name pixiset-gallery --change-set-name preview --region us-east-1
```

## Team accounts

Self-registration is disabled. Add a colleague in the Cognito console
(User pools → TeamUsers → Create user). Every user in the pool is a team member.

## Cost guard

Set an AWS Budget alarm. The audit table expires events after two years (TTL).
