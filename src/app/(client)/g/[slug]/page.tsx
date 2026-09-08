import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { publicUrl } from "@/lib/s3";
import { gateGallery } from "@/lib/gallery-access";
import Gate from "./Gate";
import GalleryView from "./GalleryView";
import GalleryClosed from "./GalleryClosed";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const g = await prisma.gallery.findUnique({
    where: { slug },
    select: { title: true },
  });
  return { title: g ? g.title : "Gallery", robots: { index: false } };
}

export default async function GalleryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { gallery, reason, access } = await gateGallery(slug);

  if (!gallery || reason === "not-found") {
    return <GalleryClosed kind="not-found" />;
  }
  if (reason === "draft") return <GalleryClosed kind="draft" />;
  if (reason === "expired") return <GalleryClosed kind="expired" />;

  if (reason === "password" || reason === "email") {
    return (
      <Gate
        slug={slug}
        title={gallery.title}
        needsPassword={Boolean(gallery.passwordHash) && reason === "password"}
        needsEmail={gallery.requireEmail}
      />
    );
  }

  // reason === "ok"
  const photos = await prisma.photo.findMany({
    where: { galleryId: gallery.id },
    orderBy: { sortOrder: "asc" },
  });
  const favorites = access
    ? await prisma.favorite.findMany({
        where: { galleryId: gallery.id, visitorId: access.visitorId },
        select: { photoId: true },
      })
    : [];

  const cover =
    photos.find((p) => p.id === gallery.coverPhotoId) ?? photos[0] ?? null;

  return (
    <GalleryView
      slug={slug}
      title={gallery.title}
      description={gallery.description}
      accentColor={gallery.accentColor}
      coverLayout={gallery.coverLayout}
      downloadEnabled={gallery.downloadEnabled}
      coverUrl={cover ? publicUrl(cover.keyDisplay) : null}
      initialFavorites={favorites.map((f) => f.photoId)}
      photos={photos.map((p) => ({
        id: p.id,
        filename: p.filename,
        width: p.width,
        height: p.height,
        thumbUrl: publicUrl(p.keyThumb),
        displayUrl: publicUrl(p.keyDisplay),
      }))}
    />
  );
}
