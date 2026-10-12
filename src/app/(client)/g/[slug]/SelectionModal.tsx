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
        ? "Добави любими снимки първо."
        : "Селекцията не може да се изпрати. Опитай отново.",
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
            <h2 className="font-serif text-xl">Селекцията е изпратена</h2>
            <p className="text-sm text-neutral-500">
              Фотографът получи твоите {count} избрани снимки.
            </p>
            <button
              onClick={onClose}
              className="rounded-full bg-ink px-4 py-2 text-sm text-white"
            >
              Затвори
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="font-serif text-xl">Изпрати селекцията</h2>
            <p className="text-sm text-neutral-500">
              Избрани снимки: {count}.
            </p>
            <input
              required
              placeholder="Твоето име"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <input
              required
              type="email"
              placeholder="Твоят имейл"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <textarea
              placeholder="Бележка (по желание)"
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
                Отказ
              </button>
              <button
                disabled={busy}
                className="rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {busy ? "Изпращане…" : "Изпрати"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
