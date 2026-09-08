# CloudFront in front of the `cdn/` prefix

CloudFront gives free/cheap cached delivery of the resized `thumb` and
`display` JPEGs. Originals are **never** served through CloudFront — the app
hands out short-lived presigned S3 URLs for those.

## Option A — simple (public prefix + CloudFront cache)

1. Apply `s3-bucket-policy.json` (edit `YOUR-BUCKET`) so only `cdn/*` is
   publicly readable. Keep **Block Public Access** = *off for bucket policy* but
   leave ACLs blocked.
2. Create a CloudFront distribution:
   - **Origin domain:** `YOUR-BUCKET.s3.REGION.amazonaws.com`
   - **Origin path:** *(leave empty)*
   - **Viewer protocol policy:** Redirect HTTP to HTTPS
   - **Cache policy:** CachingOptimized
   - **Default root object:** *(leave empty)*
3. (Recommended) Add a **CloudFront Function** on *viewer request* that returns
   `403` unless `event.request.uri` starts with `/cdn/`:

   ```js
   function handler(event) {
     var uri = event.request.uri;
     if (!uri.startsWith('/cdn/')) {
       return { statusCode: 403, statusDescription: 'Forbidden' };
     }
     return event.request;
   }
   ```

4. Set `NEXT_PUBLIC_CDN_URL=https://dXXXXXXXX.cloudfront.net` (no trailing
   `/cdn`). The app already prefixes keys with `cdn/`.

## Option B — locked down (Origin Access Control, no public bucket)

Use OAC so the bucket has **no** public policy; CloudFront signs origin
requests. Same distribution settings, plus:

- Create an **Origin Access Control** (SigV4, S3).
- Replace the bucket policy with the CloudFront-generated one that allows
  `cloudfront.amazonaws.com` to `s3:GetObject` on `arn:aws:s3:::YOUR-BUCKET/cdn/*`.
- Keep the CloudFront Function from step 3 so only `/cdn/*` is reachable.

## Local dev without CloudFront

Point `NEXT_PUBLIC_CDN_URL` straight at the bucket
(`https://YOUR-BUCKET.s3.REGION.amazonaws.com`) and apply the public `cdn/*`
policy. Fine for development; use CloudFront in production for caching + cost.
