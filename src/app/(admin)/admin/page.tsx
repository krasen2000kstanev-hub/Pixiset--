import Link from "next/link";
import { prisma } from "@/lib/db";
import NewGalleryButton from "./NewGalleryButton";

export const metadata = { title: "Galleries — Client Gallery" };
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const galleries = await prisma.gallery.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { photos: true, downloads: true, visits: true } },
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-serif text-2xl">Galleries</h1>
        <NewGalleryButton />
      </div>

      {galleries.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No galleries yet. Create your first one.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
          {galleries.map((g) => (
            <li key={g.id}>
              <Link
                href={`/admin/galleries/${g.id}`}
                className="flex items-center justify-between py-4 hover:bg-neutral-50"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{g.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        g.status === "PUBLISHED"
                          ? "bg-green-100 text-green-800"
                          : "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {g.status.toLowerCase()}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    /g/{g.slug}
                  </div>
                </div>
                <div className="text-right text-xs text-neutral-500">
                  {g._count.photos} photos · {g._count.visits} visits ·{" "}
                  {g._count.downloads} downloads
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
