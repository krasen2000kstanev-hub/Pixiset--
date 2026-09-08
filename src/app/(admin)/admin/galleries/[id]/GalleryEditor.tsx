"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { makeRenditions } from "@/lib/image-client";
import { uploadGallery, type UploadProgress } from "./upload";

type Status = "DRAFT" | "PUBLISHED";
type CoverLayout = "CENTER" | "LEFT" | "SPLIT";
type DownloadSize = "ORIGINAL" | "WEB";

interface Settings {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: Status;
  coverPhotoId: string | null;
  coverLayout: CoverLayout;
  accentColor: string;
  hasPassword: boolean;
  requireEmail: boolean;
  expiresAt: string; // yyyy-mm-dd or ""
  downloadEnabled: boolean;
  downloadSize: DownloadSize;
  notifyOnSelection: boolean;
  notifyOnBulkDownload: boolean;
  notifyEmails: string[];
}

interface PhotoLite {
  id: string;
  filename: string;
  width: number;
  height: number;
  thumbUrl: string;
}

export default function GalleryEditor({
  initial,
  photos,
  shareBase,
  emailEnabled,
}: {
  initial: Settings;
  photos: PhotoLite[];
  shareBase: string;
  emailEnabled: boolean;
}) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setSaving(true);
      const res = await fetch(`/api/admin/galleries/${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setSaving(false);
      if (res.ok) {
        setSavedAt(new Date().toLocaleTimeString());
        router.refresh();
      }
      return res.ok;
    },
    [initial.id, router],
  );

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;

    setProgress({ total: list.length, done: 0, failed: 0, phase: "processing" });
    try {
      await uploadGallery({
        galleryId: initial.id,
        files: list,
        makeRenditions,
        onProgress: setProgress,
      });
      router.refresh();
    } finally {
      setTimeout(() => setProgress(null), 1500);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function deletePhoto(photoId: string) {
    if (!confirm("Delete this photo? This cannot be undone.")) return;
    const res = await fetch(
      `/api/admin/galleries/${initial.id}/photos/${photoId}`,
      { method: "DELETE" },
    );
    if (res.ok) router.refresh();
  }

  const shareUrl = `${shareBase}${s.slug}`;

  return (
    <div className="space-y-10">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <input
          value={s.title}
          onChange={(e) => set("title", e.target.value)}
          onBlur={() => patch({ title: s.title })}
          className="font-serif text-2xl outline-none"
        />
        <div className="flex items-center gap-3">
          {saving && <span className="text-xs text-neutral-400">Saving…</span>}
          {!saving && savedAt && (
            <span className="text-xs text-neutral-400">Saved {savedAt}</span>
          )}
          <button
            onClick={() =>
              patch({
                status: s.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED",
              }).then((ok) =>
                ok
                  ? set(
                      "status",
                      s.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED",
                    )
                  : null,
              )
            }
            className={`rounded-full px-4 py-2 text-sm ${
              s.status === "PUBLISHED"
                ? "border border-neutral-300 text-neutral-600"
                : "bg-ink text-white"
            }`}
          >
            {s.status === "PUBLISHED" ? "Unpublish" : "Publish"}
          </button>
        </div>
      </div>

      {/* Share link */}
      <div className="rounded-lg border border-neutral-200 p-4">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">
          Share link
        </div>
        <div className="flex items-center gap-3">
          <code className="truncate text-sm">{shareUrl}</code>
          <button
            onClick={() => navigator.clipboard.writeText(shareUrl)}
            className="shrink-0 rounded border border-neutral-300 px-3 py-1 text-xs"
          >
            Copy
          </button>
          <a
            href={shareUrl}
            target="_blank"
            className="shrink-0 text-xs text-neutral-500 underline"
          >
            Open
          </a>
        </div>
        {s.status !== "PUBLISHED" && (
          <p className="mt-2 text-xs text-amber-600">
            Gallery is a draft — clients can’t open this link yet.
          </p>
        )}
      </div>

      {/* Upload */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-400">
          Photos ({photos.length})
        </h2>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFiles(e.dataTransfer.files);
          }}
          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 py-10 text-sm text-neutral-500 hover:border-neutral-400"
        >
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          Drop photos here or click to choose
        </label>

        {progress && (
          <div className="mt-3 text-xs text-neutral-500">
            {progress.phase === "processing" && "Resizing & uploading… "}
            {progress.phase === "done" && "Done. "}
            {progress.done}/{progress.total} uploaded
            {progress.failed > 0 && ` · ${progress.failed} failed`}
            <div className="mt-1 h-1 w-full overflow-hidden rounded bg-neutral-200">
              <div
                className="h-full bg-ink transition-all"
                style={{
                  width: `${(progress.done / progress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Grid */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {photos.map((p) => (
            <div
              key={p.id}
              className="group relative aspect-square overflow-hidden rounded bg-neutral-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.thumbUrl}
                alt={p.filename}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/50 to-transparent p-1 opacity-0 transition group-hover:opacity-100">
                <div className="flex justify-end">
                  <button
                    onClick={() => deletePhoto(p.id)}
                    className="rounded bg-white/90 px-1.5 text-xs text-red-600"
                  >
                    ✕
                  </button>
                </div>
                <button
                  onClick={() =>
                    patch({ coverPhotoId: p.id }).then(
                      (ok) => ok && set("coverPhotoId", p.id),
                    )
                  }
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    s.coverPhotoId === p.id
                      ? "bg-white text-ink"
                      : "bg-white/90 text-neutral-700"
                  }`}
                >
                  {s.coverPhotoId === p.id ? "Cover ✓" : "Set cover"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Settings */}
      <section className="grid gap-6 sm:grid-cols-2">
        <h2 className="col-span-full text-sm font-medium uppercase tracking-wide text-neutral-400">
          Settings
        </h2>

        <Field label="Description">
          <textarea
            value={s.description}
            onChange={(e) => set("description", e.target.value)}
            onBlur={() => patch({ description: s.description })}
            rows={2}
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Cover layout">
          <select
            value={s.coverLayout}
            onChange={(e) => {
              const v = e.target.value as CoverLayout;
              set("coverLayout", v);
              patch({ coverLayout: v });
            }}
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="CENTER">Centered</option>
            <option value="LEFT">Left aligned</option>
            <option value="SPLIT">Split</option>
          </select>
        </Field>

        <Field label="Accent color">
          <input
            type="color"
            value={s.accentColor}
            onChange={(e) => set("accentColor", e.target.value)}
            onBlur={() => patch({ accentColor: s.accentColor })}
            className="h-9 w-16 rounded border border-neutral-300"
          />
        </Field>

        <Field label="Access expires on">
          <input
            type="date"
            value={s.expiresAt}
            onChange={(e) => {
              set("expiresAt", e.target.value);
              patch({
                expiresAt: e.target.value
                  ? new Date(e.target.value + "T23:59:59Z").toISOString()
                  : null,
              });
            }}
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Password">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={s.hasPassword ? "•••••• (set)" : "No password"}
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <button
              onClick={() =>
                patch({ password: passwordInput }).then((ok) => {
                  if (ok) {
                    set("hasPassword", passwordInput.length > 0);
                    setPasswordInput("");
                  }
                })
              }
              className="shrink-0 rounded border border-neutral-300 px-3 text-xs"
            >
              Save
            </button>
            {s.hasPassword && (
              <button
                onClick={() =>
                  patch({ password: null }).then(
                    (ok) => ok && set("hasPassword", false),
                  )
                }
                className="shrink-0 rounded border border-neutral-300 px-3 text-xs text-red-600"
              >
                Clear
              </button>
            )}
          </div>
        </Field>

        <Toggle
          label="Require email to view"
          checked={s.requireEmail}
          onChange={(v) => {
            set("requireEmail", v);
            patch({ requireEmail: v });
          }}
        />

        <Toggle
          label="Allow downloads"
          checked={s.downloadEnabled}
          onChange={(v) => {
            set("downloadEnabled", v);
            patch({ downloadEnabled: v });
          }}
        />

        <Field label="Download size">
          <select
            value={s.downloadSize}
            onChange={(e) => {
              const v = e.target.value as DownloadSize;
              set("downloadSize", v);
              patch({ downloadSize: v });
            }}
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="ORIGINAL">Original files</option>
            <option value="WEB">Web size (2560px)</option>
          </select>
        </Field>

        {emailEnabled ? (
          <>
            <Toggle
              label="Email me when a client sends a selection"
              checked={s.notifyOnSelection}
              onChange={(v) => {
                set("notifyOnSelection", v);
                patch({ notifyOnSelection: v });
              }}
            />
            <Toggle
              label="Email me when a client downloads everything"
              checked={s.notifyOnBulkDownload}
              onChange={(v) => {
                set("notifyOnBulkDownload", v);
                patch({ notifyOnBulkDownload: v });
              }}
            />
            <Field label="Notification recipients (comma separated, blank = default)">
              <input
                type="text"
                defaultValue={s.notifyEmails.join(", ")}
                onBlur={(e) => {
                  const list = e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean);
                  patch({ notifyEmails: list });
                }}
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </Field>
          </>
        ) : (
          <p className="col-span-full text-xs text-neutral-400">
            Email notifications are off — set <code>SES_FROM</code> in the
            environment to enable them.
          </p>
        )}
      </section>

      <DangerZone galleryId={initial.id} />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function DangerZone({ galleryId }: { galleryId: string }) {
  const router = useRouter();
  return (
    <section className="border-t border-neutral-200 pt-6">
      <button
        onClick={async () => {
          if (
            !confirm(
              "Delete this gallery and all its photos permanently? This cannot be undone.",
            )
          )
            return;
          const res = await fetch(`/api/admin/galleries/${galleryId}`, {
            method: "DELETE",
          });
          if (res.ok) router.push("/admin");
        }}
        className="text-sm text-red-600"
      >
        Delete gallery
      </button>
    </section>
  );
}
