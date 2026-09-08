# AWS SES — email notifications (optional)

Notifications are **off** until `SES_FROM` is set. Per-gallery toggles in the
admin UI ("Email me when a client sends a selection" / "…downloads everything")
only appear when SES is configured.

## Steps

1. **SES → Verified identities → Create identity.**
   - Verify a **domain** (recommended): add the DKIM CNAME records SES gives you
     to your DNS. Wait for status *Verified*.
   - Or verify a single **email address** for a quick start.

2. **Leave the SES sandbox** (SES → Account dashboard → *Request production
   access*). In the sandbox you can only send to verified addresses — fine for
   testing, since your notification recipients are your own addresses.

3. **Environment:**
   ```
   SES_FROM=galleries@your-domain.com
   SES_DEFAULT_TO=you@your-domain.com,assistant@your-domain.com
   AWS_REGION=eu-central-1        # must match the region where SES is verified
   ```
   `SES_DEFAULT_TO` is the fallback recipient list; each gallery can override it
   in **Settings → Notification recipients**.

4. The app's IAM user needs `ses:SendEmail` (already in `iam-policy.json`).

## What gets sent

| Trigger | Condition |
|---|---|
| Client submits a favorites selection | gallery `notifyOnSelection` = on |
| Client uses "Download all" | gallery `notifyOnBulkDownload` = on |

Emails are plain text and include a link back to the gallery's activity page.
Failures are logged and never block the client action.
