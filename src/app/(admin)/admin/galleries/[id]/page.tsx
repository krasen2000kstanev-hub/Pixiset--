import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { publicUrl } from "@/lib/s3";
import { appUrl, emailEnabled } from "@/lib/env";
import GalleryEditor from "./GalleryEditor";

export const dynamic = "force-dynamic";

export default async function GalleryEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const gallery = await prisma.gallery.findUnique({
    where: { id },
    include: { photos: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();

  const photos = gallery.photos.map((p) => ({
    id: p.id,
    filename: p.filename,
    width: p.width,
    height: p.height,
    thumbUrl: publicUrl(p.keyThumb),
  }));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <Link href="/admin" className="text-sm text-neutral-500">
          ← All galleries
        </Link>
        <Link
          href={`/admin/galleries/${id}/activity`}
          className="text-sm text-neutral-500 hover:text-ink"
        >
          Activity →
        </Link>
      </div>

      <GalleryEditor
        shareBase={`${appUrl()}/g/`}
        emailEnabled={emailEnabled()}
        initial={{
          id: gallery.id,
          slug: gallery.slug,
          title: gallery.title,
          description: gallery.description ?? "",
          status: gallery.status,
          coverPhotoId: gallery.coverPhotoId,
          coverLayout: gallery.coverLayout,
          accentColor: gallery.accentColor,
          hasPassword: Boolean(gallery.passwordHash),
          requireEmail: gallery.requireEmail,
          expiresAt: gallery.expiresAt
            ? gallery.expiresAt.toISOString().slice(0, 10)
            : "",
          downloadEnabled: gallery.downloadEnabled,
          downloadSize: gallery.downloadSize,
          notifyOnSelection: gallery.notifyOnSelection,
          notifyOnBulkDownload: gallery.notifyOnBulkDownload,
          notifyEmails: gallery.notifyEmails,
        }}
        photos={photos}
      />
    </div>
  );
}
