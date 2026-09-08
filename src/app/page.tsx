export default function Home() {
  return (
    <main className="min-h-screen bg-[#171614] text-[#f5f1e8]">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-7 lg:px-10">
        <div className="font-serif text-2xl tracking-wide">atelier / 01</div>
        <span className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/60">Demo gallery</span>
      </header>
      <section className="mx-auto max-w-7xl px-6 pb-16 pt-12 lg:px-10 lg:pt-20">
        <p className="mb-5 text-xs uppercase tracking-[0.3em] text-[#d7ad76]">Sofia · September 2026</p>
        <h1 className="max-w-3xl font-serif text-6xl leading-[0.95] md:text-8xl">A quiet day<br />by the sea.</h1>
        <p className="mt-8 max-w-md text-base leading-7 text-white/60">A private space for your photographs, memories, and favourite frames.</p>
        <div className="mt-14 grid grid-cols-2 gap-3 md:grid-cols-4">
          {["photo-1519741497674-611481863552","photo-1507504031003-b417219a0fde","photo-1511285560929-80b456fea0bc","photo-1504150558240-0b4fd8946624","photo-1519225421980-301d8d3f7c72","photo-1494955870715-979ca4f5f9a9","photo-1515934751635-c81c6bc9a2d8","photo-1519167758481-83f550bb49b3"].map((id, i) => (
            <img key={id} src={`https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=85`} alt={`Gallery photograph ${i + 1}`} className={`h-64 w-full rounded-sm object-cover md:h-80 ${i === 1 || i === 6 ? "md:mt-16" : ""}`} />
          ))}
        </div>
      </section>
    </main>
  );
}
