const search=document.querySelector('#gallerySearch');
const filter=document.querySelector('#galleryFilter');
const applyFilters=()=>{const q=(search.value||'').toLowerCase().trim();const status=filter.value;document.querySelectorAll('.gallery').forEach(g=>{const text=g.textContent.toLowerCase();const visible=(!q||text.includes(q))&&(status==='ALL'||text.includes(status));g.hidden=!visible})};
search?.addEventListener('input',applyFilters);filter?.addEventListener('change',applyFilters);new MutationObserver(applyFilters).observe(document.querySelector('#list'),{childList:true,subtree:true});
const metaScript=document.createElement('script');metaScript.src='admin-meta.js?v=1';document.head.append(metaScript);
