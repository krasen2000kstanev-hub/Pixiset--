const COPY: Record<string, { title: string; body: string }> = {
  "not-found": {
    title: "Галерията не е намерена",
    body: "Линкът може да е грешен или галерията е премахната.",
  },
  draft: {
    title: "Галерията още не е достъпна",
    body: "Галерията не е публикувана. Провери отново по-късно.",
  },
  expired: {
    title: "Галерията е изтекла",
    body: "Достъпът до снимките е затворен. Свържи се с фотографа.",
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
