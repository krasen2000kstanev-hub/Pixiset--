"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Gate({
  slug,
  title,
  needsPassword,
  needsEmail,
}: {
  slug: string;
  title: string;
  needsPassword: boolean;
  needsEmail: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/g/${slug}/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        password: needsPassword ? password : undefined,
        email: needsEmail ? email : undefined,
      }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const { error } = await res.json().catch(() => ({ error: "error" }));
    setError(
      error === "bad-password"
        ? "That password isn’t right."
        : error === "email-required"
          ? "Please enter your email."
          : "Something went wrong. Try again.",
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-6">
      <h1 className="font-serif text-2xl">{title}</h1>
      <p className="text-center text-sm text-neutral-500">
        {needsPassword
          ? "This gallery is private. Enter the password to continue."
          : "Please enter your email to view this gallery."}
      </p>
      <form onSubmit={submit} className="w-full space-y-3">
        {needsPassword && (
          <input
            type="password"
            autoFocus
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        )}
        {needsEmail && (
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? "Checking…" : "View gallery"}
        </button>
      </form>
    </main>
  );
}
