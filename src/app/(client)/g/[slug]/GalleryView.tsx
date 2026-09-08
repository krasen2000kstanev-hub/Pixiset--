"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { justifiedRows } from "@/lib/justified";
import Lightbox from "./Lightbox";
import SelectionModal from "./SelectionModal";
import { triggerDownload, downloadAll } from "./download";

export interface ClientPhoto {
  id: string;
  filename: string;
  width: number;
  height: number;
  thumbUrl: string;
  displayUrl: string;
}

interface Props {
  slug: string;
  title: string;
  description: string | null;
  accentColor: string;
  coverLayout: "CENTER" | "LEFT" | "SPLIT";
  downloadEnabled: boolean;
  coverUrl: string | null;
  photos: ClientPhoto[];
  initialFavorites: string[];
}

export default function GalleryView(props: Props) {
  const { slug, photos, downloadEnabled } = props;

  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(props.initialFavorites),
  );
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fetch(`/api/g/${slug}/visit`, { method: "POST" }).catch(() => {});
  }, [slug]);

  const visible = useMemo(
    () => (showFavoritesOnly ? photos.filter((p) => favorites.has(p.id)) : photos),
    [showFavoritesOnly, photos, favorites],
  );

  const rows = useMemo(
    () => (width > 0 ? justifiedRows(visible, width, 320, 8) : []),
    [visible, width],
  );

  async function toggleFavorite(photoId: string) {
    // optimistic
    setFavorites((prev) => {
      const next = new Set(prev);
      next.has(photoId) ? next.delete(photoId) : next.add(photoId);
      return next;
    });
    try {
      const res = await fetch(`/api/g/${slug}/favorites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoId }),
      });
      if (res.ok) {
        const { photoIds } = await res.json();
        setFavorites(new Set(photoIds));
      }
    } catch {
      /* keep optimistic state */
    }
  }

  async function onDownloadOne(photoId: string) {
    const res = await fetch(`/api/g/${slug}/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoId }),
    });
    if (!res.ok) return;
    const { url, filename } = await res.json();
    triggerDownload(url, filename);
  }

  async function onDownloadAll() {
    if (!confirm(`Download all ${photos.length} photos?`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/g/${slug}/download`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (res.ok) {
        const { files } = await res.json();
        await downloadAll(files);
      }
    } finally {
      setBulkBusy(false);
    }
  }

  const favCount = favorites.size;

  return (
    <div
      style={{ "--accent": props.accentColor } as React.CSSProperties}
    >
      <Cover {...props} photoCount={photos.length} />

      {/* Sticky toolbar */}
      <div className="sticky top-0 z-20 border-b border-neutral-200 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFavoritesOnly(false)}
              className={!showFavoritesOnly ? "font-medium" : "text-neutral-500"}
            >
              All {photos.length}
            </button>
            <span className="text-neutral-300">·</span>
            <button
              onClick={() => setShowFavoritesOnly(true)}
              className={showFavoritesOnly ? "font-medium" : "text-neutral-500"}
            >
              Favorites {favCount}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {favCount > 0 && (
              <button
                onClick={() => setSelectionOpen(true)}
                className="rounded-full px-3 py-1.5 text-white"
                style={{ background: "var(--accent)" }}
              >
                Send selection
              </button>
            )}
            {downloadEnabled && (
              <button
                onClick={onDownloadAll}
                disabled={bulkBusy}
                className="rounded-full border border-neutral-300 px-3 py-1.5 disabled:opacity-50"
              >
                {bulkBusy ? "Preparing…" : "Download all"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div ref={gridRef} className="mx-auto max-w-6xl px-4 py-6">
        {visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-neutral-500">
            No favorites yet. Tap the heart on a photo to add it.
          </p>
        ) : (
          rows.map((row, ri) => (
            <div key={ri} className="justified-row">
              {row.map(({ item, width: w, height: h }) => {
                const idx = visible.indexOf(item);
                return (
                  <button
                    key={item.id}
                    onClick={() => setLightboxIndex(idx)}
                    className="group relative shrink-0 overflow-hidden bg-neutral-100"
                    style={{ width: w, height: h }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.thumbUrl}
                      alt={item.filename}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(item.id);
                      }}
                      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/85 text-sm opacity-0 transition group-hover:opacity-100"
                      aria-label="Toggle favorite"
                    >
                      {favorites.has(item.id) ? "♥" : "♡"}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      {lightboxIndex !== null && visible[lightboxIndex] && (
        <Lightbox
          photos={visible}
          index={lightboxIndex}
          favorites={favorites}
          downloadEnabled={downloadEnabled}
          onClose={() => setLightboxIndex(null)}
          onNav={setLightboxIndex}
          onToggleFavorite={toggleFavorite}
          onDownload={onDownloadOne}
        />
      )}

      {selectionOpen && (
        <SelectionModal
          slug={slug}
          count={favCount}
          onClose={() => setSelectionOpen(false)}
        />
      )}
    </div>
  );
}

function Cover({
  title,
  description,
  coverUrl,
  coverLayout,
  photoCount,
}: Props & { photoCount: number }) {
  const align =
    coverLayout === "LEFT"
      ? "items-start text-left"
      : coverLayout === "SPLIT"
        ? "items-start text-left md:pl-[8%]"
        : "items-center text-center";

  return (
    <header className="relative flex h-[70vh] min-h-[380px] w-full flex-col justify-center overflow-hidden bg-neutral-900">
      {coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-70"
        />
      )}
      <div
        className={`relative mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 text-white ${align}`}
      >
        <h1 className="font-serif text-4xl md:text-5xl">{title}</h1>
        {description && (
          <p className="max-w-lg text-sm text-white/80">{description}</p>
        )}
        <p className="text-xs uppercase tracking-widest text-white/60">
          {photoCount} photos
        </p>
      </div>
    </header>
  );
}
