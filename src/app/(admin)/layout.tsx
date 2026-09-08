import Link from "next/link";
import { auth, signOut } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <div className="min-h-screen bg-white">
      {session?.user && (
        <header className="border-b border-neutral-200">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <Link href="/admin" className="font-serif text-lg">
              Client Gallery
            </Link>
            <div className="flex items-center gap-4 text-sm text-neutral-500">
              <span>{session.user.email}</span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/admin/login" });
                }}
              >
                <button className="hover:text-ink">Sign out</button>
              </form>
            </div>
          </div>
        </header>
      )}
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
