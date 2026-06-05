// netlify/functions/keep-alive.js
// Pings dmassistent en jobsvendor elke 4 minuten om cold starts te vermijden.

export default async () => {
  const base = process.env.URL || 'https://atalianqrportal.netlify.app';

  await Promise.all([
    fetch(`${base}/.netlify/functions/dmassistent`).catch(() => {}),
    fetch(`${base}/.netlify/functions/jobsvendor`).catch(() => {}),
  ]);

  return new Response('ok', { status: 200 });
};
