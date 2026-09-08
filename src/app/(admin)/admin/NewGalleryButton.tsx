"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewGalleryButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/galleries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Could not create gallery.");
      return;
    }
    const { gallery } = await res.json();
    router.push(`/admin/galleries/${gallery.id}`);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-full bg-ink px-4 py-2 text-sm text-white"
      >
        New gallery
      </button>
    );
  }

  return (
    <form onSubmit={create} className="flex items-center gap-2">
      <input
        autoFocus
        placeholder="Gallery title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="rounded border border-neutral-300 px-3 py-2 text-sm"
        required
      />
      <button
        disabled={busy}
        className="rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-sm text-neutral-500"
      >
        Cancel
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  );
}
