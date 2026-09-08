"use client";

import { useState } from "react";

export default function SelectionModal({
  slug,
  count,
  onClose,
}: {
  slug: string;
  count: number;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/g/${slug}/favorites/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, note }),
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      return;
    }
    const { error } = await res.json().catch(() => ({ error: "" }));
    setError(
      error === "no-favorites"
        ? "Add some favorites first."
        : "Could not send. Please try again.",
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="space-y-3 text-center">
            <h2 className="font-serif text-xl">Selection sent</h2>
            <p className="text-sm text-neutral-500">
              Your photographer has received your {count} favorite
              {count === 1 ? "" : "s"}.
            </p>
            <button
              onClick={onClose}
              className="rounded-full bg-ink px-4 py-2 text-sm text-white"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="font-serif text-xl">Send your selection</h2>
            <p className="text-sm text-neutral-500">
              {count} photo{count === 1 ? "" : "s"} selected.
            </p>
            <input
              required
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <input
              required
              type="email"
              placeholder="Your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <textarea
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-4 py-2 text-sm text-neutral-500"
              >
                Cancel
              </button>
              <button
                disabled={busy}
                className="rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
