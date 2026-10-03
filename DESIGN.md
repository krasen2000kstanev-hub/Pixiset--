# DESIGN.md

> Pixiset: a calm, clear dark workspace for photographers and a fast, distraction-free client gallery.

## 1. Visual Theme & Atmosphere

**Style:** Dark editorial gallery workspace  
**Keywords:** calm, photographic, warm, spacious, professional, clear  
**Interaction Tier:** L1 — native JavaScript and CSS only; no new UI dependencies.

## 2. Color Palette & Roles

```css
:root{--bg:#171614;--surface:#211f1d;--surface-alt:#2a2825;--surface-hover:#322f2b;--border:#ffffff22;--border-hover:#d7ad76;--text:#f5f1e8;--text-secondary:#d3ccc0;--text-tertiary:#ffffff99;--accent:#d7ad76;--accent-hover:#e6bd8b;--bg-rgb:23,22,20;--accent-rgb:215,173,118;--success:#b8f0d8;--error:#f09a9a;--warning:#f0cf88}
```

Use variables for new UI colors. Accent is reserved for primary actions and selected state. Statuses must include text, not color alone.

## 3. Typography Rules

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@500;600&display=swap');
```

Use Playfair Display for page titles and DM Sans for UI/body. Dashboard title 42px, section title 22px, body 15px/1.5, labels 12px/1.3. Do not use decorative fonts for controls.

## 4. Component Stylings

```css
button{min-height:44px;border:1px solid var(--border);border-radius:6px;padding:10px 14px;background:var(--surface-alt);color:var(--text);font:inherit;font-weight:600;cursor:pointer}button:hover{background:var(--surface-hover);border-color:var(--border-hover)}button:active{transform:translateY(1px)}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button:disabled{opacity:.45;cursor:not-allowed}.gallery-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden}.gallery-card:hover{border-color:var(--border-hover)}a{color:var(--text-secondary)}a:hover{color:var(--accent)}.status{border-radius:999px;padding:4px 9px;font-size:12px;font-weight:600}.status.published{background:var(--success);color:#163b2d}.status.draft{background:var(--surface-alt);color:var(--text-secondary)}
```

## 5. Layout Principles

Max width 1440px; page padding 24px desktop/12px mobile; spacing scale 8/12/16/24/32/48px.

```css
.gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:24px}
```

## 6. Depth & Elevation

Flat page background; subtle cards `0 4px 18px rgba(0,0,0,.16)`; elevated lightbox/menu `0 12px 36px rgba(0,0,0,.28)`.

## 7. Animation & Interaction

L1 only: opacity/transform entrance and short hover transitions. No scroll hijacking, parallax, WebGL or new animation library.

```css
@keyframes fade-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.gallery-card{animation:fade-in .22s ease both}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
```

## 8. Do's and Don'ts

**Do:** show status, cover, count and date; collapse heavy operations; use Bulgarian labels; keep originals separate from thumbnails; provide upload/publish/delete feedback.

**Don't:**

- Do not render every photo of every gallery at once.
- Do not use originals as card previews.
- Do not hide PUBLISHED/DRAFT in technical text.
- Do not use success alerts for normal operations.
- Do not add CloudFront or libraries without measured need.
- Do not delete originals when generating thumbnails.
- Do not expose DRAFT galleries to clients.
- Do not treat expired login as an empty gallery list.

## 9. Responsive Behavior

Desktop >1000px: 4–5 cards/row. Tablet 600–1000px: 2–3 cards/row. Mobile <600px: one card/row and full-width controls. Touch targets are minimum 44px. Gallery cards are collapsed by default; only the selected card reveals operations.

```css
@media(max-width:1000px){.gallery-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.gallery-grid{grid-template-columns:1fr}.gallery-card button{width:100%}}
```
