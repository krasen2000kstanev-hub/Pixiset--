"use client";

import { useEffect, useRef } from "react";
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
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < photos.length - 1) onNav(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onNav(index - 1);
      if (e.key.toLowerCase() === "f") onToggleFavorite(photo.id);
      if (e.key === "Tab") {
        e.preventDefault();
        closeRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, photo, onClose, onNav, onToggleFavorite]);

  if (!photo) return null;
  const isFav = favorites.has(photo.id);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label={`Снимка ${index + 1} от ${photos.length}`}
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
            className="min-h-11 min-w-11 text-lg"
            aria-label={isFav ? "Премахни от любими" : "Добави в любими"}
          >
            {isFav ? "♥" : "♡"}
          </button>
          {downloadEnabled && (
            <button onClick={() => onDownload(photo.id)} className="min-h-11 px-2">Свали</button>
          )}
          <button ref={closeRef} onClick={onClose} aria-label="Затвори" className="min-h-11 min-w-11 text-lg">
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
            aria-label="Предишна снимка"
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
            aria-label="Следваща снимка"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}
