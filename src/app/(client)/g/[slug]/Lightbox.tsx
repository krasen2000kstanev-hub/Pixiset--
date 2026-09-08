"use client";

import { useEffect } from "react";
import type { ClientPhoto } from "./GalleryView";

export default function Lightbox({
  photos,
  index,
  favorites,
  downloadEnabled,
  onClose,
  onNav,
  onToggleFavorite,
  onDownload,
}: {
  photos: ClientPhoto[];
  index: number;
  favorites: Set<string>;
  downloadEnabled: boolean;
  onClose: () => void;
  onNav: (i: number) => void;
  onToggleFavorite: (photoId: string) => void;
  onDownload: (photoId: string) => void;
}) {
  const photo = photos[index];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < photos.length - 1) onNav(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onNav(index - 1);
      if (e.key.toLowerCase() === "f") onToggleFavorite(photo.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, photo, onClose, onNav, onToggleFavorite]);

  if (!photo) return null;
  const isFav = favorites.has(photo.id);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between px-4 py-3 text-sm text-white/80"
        onClick={(e) => e.stopPropagation()}
      >
        <span>
          {index + 1} / {photos.length}
        </span>
        <div className="flex items-center gap-4">
          <button
            onClick={() => onToggleFavorite(photo.id)}
            className="text-lg"
            aria-label="Favorite"
          >
            {isFav ? "♥" : "♡"}
          </button>
          {downloadEnabled && (
            <button onClick={() => onDownload(photo.id)}>Download</button>
          )}
          <button onClick={onClose} aria-label="Close" className="text-lg">
            ✕
          </button>
        </div>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        {index > 0 && (
          <button
            onClick={() => onNav(index - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-white"
            aria-label="Previous"
          >
            ‹
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.displayUrl}
          alt={photo.filename}
          className="max-h-full max-w-full object-contain"
        />
        {index < photos.length - 1 && (
          <button
            onClick={() => onNav(index + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-white"
            aria-label="Next"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}
