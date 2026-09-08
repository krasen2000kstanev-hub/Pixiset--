import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { emailEnabled, defaultNotifyRecipients, appUrl } from "@/lib/env";

const region = process.env.AWS_REGION || "eu-central-1";
let client: SESv2Client | null = null;

function ses(): SESv2Client {
  if (!client) client = new SESv2Client({ region });
  return client;
}

interface SendArgs {
  to: string[];
  subject: string;
  text: string;
}

async function send({ to, subject, text }: SendArgs): Promise<void> {
  if (!emailEnabled()) return;
  const recipients = to.filter(Boolean);
  if (recipients.length === 0) return;

  await ses().send(
    new SendEmailCommand({
      FromEmailAddress: process.env.SES_FROM,
      Destination: { ToAddresses: recipients },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Text: { Data: text, Charset: "UTF-8" } },
        },
      },
    }),
  );
}

function resolveRecipients(galleryEmails: string[]): string[] {
  const list = galleryEmails.length ? galleryEmails : defaultNotifyRecipients();
  return Array.from(new Set(list.map((e) => e.trim().toLowerCase()))).filter(
    Boolean,
  );
}

export interface SelectionNotifyArgs {
  gallery: { title: string; slug: string; notifyEmails: string[] };
  name: string;
  email: string;
  note?: string | null;
  count: number;
}

export async function notifySelection(a: SelectionNotifyArgs): Promise<void> {
  const to = resolveRecipients(a.gallery.notifyEmails);
  await send({
    to,
    subject: `New photo selection — ${a.gallery.title}`,
    text: [
      `${a.name} (${a.email}) submitted a selection of ${a.count} photo(s).`,
      a.note ? `\nNote:\n${a.note}` : "",
      ``,
      `Open the gallery activity page:`,
      `${appUrl()}/admin/galleries?slug=${a.gallery.slug}`,
    ].join("\n"),
  });
}

export interface BulkDownloadNotifyArgs {
  gallery: { title: string; slug: string; notifyEmails: string[] };
  email?: string | null;
  ip?: string | null;
  count: number;
}

export async function notifyBulkDownload(
  a: BulkDownloadNotifyArgs,
): Promise<void> {
  const to = resolveRecipients(a.gallery.notifyEmails);
  await send({
    to,
    subject: `Gallery downloaded — ${a.gallery.title}`,
    text: [
      `Someone downloaded all ${a.count} photo(s) from "${a.gallery.title}".`,
      a.email ? `Visitor email: ${a.email}` : `Visitor email: (not collected)`,
      a.ip ? `IP: ${a.ip}` : "",
      ``,
      `${appUrl()}/admin/galleries?slug=${a.gallery.slug}`,
    ].join("\n"),
  });
}
