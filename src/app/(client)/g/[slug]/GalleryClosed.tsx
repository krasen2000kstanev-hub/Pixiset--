const COPY: Record<string, { title: string; body: string }> = {
  "not-found": {
    title: "Gallery not found",
    body: "This link may be wrong or the gallery has been removed.",
  },
  draft: {
    title: "Not available yet",
    body: "This gallery hasn’t been published. Please check back later.",
  },
  expired: {
    title: "This gallery has expired",
    body: "Access to these photos has closed. Contact your photographer to reopen it.",
  },
};

export default function GalleryClosed({
  kind,
}: {
  kind: "not-found" | "draft" | "expired";
}) {
  const c = COPY[kind];
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-serif text-2xl">{c.title}</h1>
      <p className="text-sm text-neutral-500">{c.body}</p>
    </main>
  );
}
