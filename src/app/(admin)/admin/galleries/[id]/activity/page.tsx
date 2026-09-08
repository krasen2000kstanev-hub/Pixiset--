import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const gallery = await prisma.gallery.findUnique({
    where: { id },
    select: { id: true, title: true, slug: true },
  });
  if (!gallery) notFound();

  const [visits, downloads, submissions, totals] = await Promise.all([
    prisma.galleryVisit.findMany({
      where: { galleryId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.downloadEvent.findMany({
      where: { galleryId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { photo: { select: { filename: true } } },
    }),
    prisma.favoriteSubmission.findMany({
      where: { galleryId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.$transaction([
      prisma.galleryVisit.count({ where: { galleryId: id } }),
      prisma.downloadEvent.count({ where: { galleryId: id } }),
      prisma.favorite.count({ where: { galleryId: id } }),
    ]),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Link
          href={`/admin/galleries/${id}`}
          className="text-sm text-neutral-500"
        >
          ← {gallery.title}
        </Link>
        <a
          href={`/api/admin/galleries/${id}/activity?export=downloads`}
          className="rounded border border-neutral-300 px-3 py-1.5 text-xs"
        >
          Export downloads CSV
        </a>
      </div>

      <h1 className="font-serif text-2xl">Activity</h1>

      <div className="grid grid-cols-3 gap-4 text-center">
        <Stat label="Visits" value={totals[0]} />
        <Stat label="Downloads" value={totals[1]} />
        <Stat label="Favorites" value={totals[2]} />
      </div>

      <Section title={`Selections sent (${submissions.length})`}>
        {submissions.length === 0 ? (
          <Empty>No selections submitted yet.</Empty>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {submissions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between py-3 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {s.name}{" "}
                    <span className="font-normal text-neutral-500">
                      &lt;{s.email}&gt;
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500">
                    {s.photoIds.length} photos · {fmt(s.createdAt)}
                    {s.note ? ` · “${s.note}”` : ""}
                  </div>
                </div>
                <a
                  href={`/api/admin/galleries/${id}/activity?export=selection&sid=${s.id}`}
                  className="rounded border border-neutral-300 px-3 py-1 text-xs"
                >
                  Download list
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Downloads (${downloads.length} shown)`}>
        {downloads.length === 0 ? (
          <Empty>Nothing downloaded yet.</Empty>
        ) : (
          <Table
            head={["When", "Type", "Photo", "Email", "IP"]}
            rows={downloads.map((d) => [
              fmt(d.createdAt),
              d.type === "BULK" ? "All photos" : "Single",
              d.photo?.filename ?? (d.type === "BULK" ? "—" : "(deleted)"),
              d.email ?? "—",
              d.ip ?? "—",
            ])}
          />
        )}
      </Section>

      <Section title={`Visits (${visits.length} shown)`}>
        {visits.length === 0 ? (
          <Empty>No visits recorded yet.</Empty>
        ) : (
          <Table
            head={["When", "Email", "IP", "Device"]}
            rows={visits.map((v) => [
              fmt(v.createdAt),
              v.email ?? "—",
              v.ip ?? "—",
              shortUA(v.userAgent),
            ])}
          />
        )}
      </Section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-200 py-4">
      <div className="text-2xl font-medium">{value}</div>
      <div className="text-xs uppercase tracking-wide text-neutral-400">
        {label}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-neutral-500">{children}</p>;
}

function Table({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-400">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-neutral-100">
              {r.map((c, j) => (
                <td key={j} className="py-2 pr-4 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmt(d: Date): string {
  return new Date(d).toLocaleString();
}

function shortUA(ua: string | null): string {
  if (!ua) return "—";
  const m =
    /(Chrome|Firefox|Safari|Edg|OPR)\/[\d.]+/.exec(ua)?.[0] ?? ua.slice(0, 40);
  return m;
}
