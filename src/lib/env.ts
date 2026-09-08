/**
 * Small helpers for reading environment configuration and feature flags.
 * Kept dependency-free so it can be imported from both server and edge code.
 */

export function appUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function cdnUrl(): string {
  const v = process.env.NEXT_PUBLIC_CDN_URL;
  if (!v) throw new Error("NEXT_PUBLIC_CDN_URL is not set");
  return v.replace(/\/$/, "");
}

/** Email notifications are only available when a verified SES sender is set. */
export function emailEnabled(): boolean {
  return Boolean(process.env.SES_FROM && process.env.SES_FROM.includes("@"));
}

export function defaultNotifyRecipients(): string[] {
  return (process.env.SES_DEFAULT_TO || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
