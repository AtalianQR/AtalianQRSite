export default () =>
  new Response(JSON.stringify({ ok: true, runtime: "edge" }), {
    status: 200, headers: { "content-type": "application/json" }
  });
export const config = { path: "/api/health" };
