import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="font-serif text-3xl">Client Gallery</h1>
      <p className="text-sm text-neutral-500">
        Private photo galleries for your clients. Open a gallery from the link
        your photographer shared with you, or sign in to manage galleries.
      </p>
      <Link
        href="/admin"
        className="rounded-full bg-ink px-5 py-2 text-sm text-white"
      >
        Admin sign in
      </Link>
    </main>
  );
}
