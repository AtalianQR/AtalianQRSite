// … binnen jouw bestaande ticketFlow(contextLabel)
const desc = await askProblem();

// >>> NIEUW: foto vragen (optioneel)
let photoDataUrl = null;
if (window.ATALIAN_PHOTO?.askPhoto) {
  photoDataUrl = await window.ATALIAN_PHOTO.askPhoto(botui, 'Wil je een foto toevoegen van het probleem? 📷');
} else {
  await botui.message.add({ content: 'Foto’s nemen is hier niet beschikbaar.' });
}

const email = await askEmail();
await botui.message.add({ content: `Is dit dringend, ${USERNAME}?` });
const urgent = await botui.action.button({
  action: [
    { text: '🚨 Ja, dringend', value: 'ja' },
    { text: '⏱️ Nee, kan wachten', value: 'nee' },
  ]
});
if (urgent.value === 'ja') {
  await botui.message.add({
    type: 'html',
    content: 'Normaal zou je nu het telefoonnummer van de servicedesk krijgen ☎️.<br><b>Maar omdat ze zelf deelnemen aan dit event, laten we ze vandaag met rust 😇.</b>'
  });
}

// Fake ID + opslag (in localStorage)
const fakeId = 'TCK-' + Math.random().toString(36).slice(2, 6).toUpperCase();
try {
  const payload = { contextLabel, urgent: urgent.value, desc, email, photo: photoDataUrl || null, ts: Date.now() };
  // Bewaar per demo-tickets logje (kan handig zijn voor latere stats.html)
  const key = 'atalian_demo_tickets';
  const arr = JSON.parse(localStorage.getItem(key) || '[]');
  arr.push(payload);
  localStorage.setItem(key, JSON.stringify(arr));
} catch(e) { /* ignore quota */ }

await botui.message.add({
  type:'html',
  content: `Bedankt! Je <b>${contextLabel}</b> is verzonden naar Ultimo ✅<br><span class="hint">(Demo, geen echte ticket) – ref: ${fakeId}</span>`
});

await botui.message.add({
  type:'html',
  content:
    `<span class="hint">Samenvatting:</span><br>
     • Urgent: <b>${urgent.value === 'ja' ? 'ja' : 'nee'}</b><br>
     • Beschrijving: <b>${desc || '-'}</b><br>
     • Contact: <b>${email}</b>${photoDataUrl ? '<br>• Foto: <i>bijgevoegd</i>' : ''}`
});
