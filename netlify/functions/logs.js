export default async (req) => {
  const u = new URL(req.url);
  const qs = u.search; // behoud query (limit, since, ...)
  const r = await fetch('https://atalian-logs.atalianqr.workers.dev/api/log' + qs, {
    headers: { 'Accept':'application/json' }
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { 'Content-Type':'application/json','Cache-Control':'no-store' }
  });
};
