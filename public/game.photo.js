<script>
// ===== game.photo.js =====

// UI helper: laad een verborgen <input type="file"> voor camera/galerij
function createHiddenFileInput() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment'; // mobiel: open achtercamera
  input.style.display = 'none';
  document.body.appendChild(input);
  return input;
}

// Lees bestand -> dataURL
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// Optionele compressie (canvas) om dataURL kleiner te maken
async function compressDataUrl(dataUrl, maxW = 1200, quality = 0.8) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = function() {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      // Gebruik JPEG voor betere compressie
      const out = canvas.toDataURL('image/jpeg', quality);
      resolve(out);
    };
    img.src = dataUrl;
  });
}

/**
 * Vraag 1 foto (camera of galerij), toon preview in BotUI, en geef de dataURL terug.
 * @param {object} botui - je BotUI instantie
 * @param {string} label - bvb. 'Maak een foto van het probleem'
 * @param {boolean} compress - of we comprimeren
 * @returns {Promise<string|null>} dataURL of null als geannuleerd
 */
async function askPhoto(botui, label = 'Maak een foto van het probleem 📷', compress = true) {
  await botui.message.add({ content: label });

  // Toon knoppen: Foto nemen / Overslaan
  const choice = await botui.action.button({
    action: [
      { text: '📷 Foto nemen / kiezen', value: 'snap' },
      { text: '⏭️ Overslaan', value: 'skip' },
    ]
  });
  if (choice.value === 'skip') {
    await botui.message.add({ content: 'Oké, we gaan verder zonder foto 👍' });
    return null;
  }

  // Bouw hidden input en trigger klik
  const input = createHiddenFileInput();
  const p = new Promise((resolve) => {
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.remove(); // opkuis
      if (!file) {
        await botui.message.add({ content: 'Geen bestand geselecteerd 🙈' });
        resolve(null);
        return;
      }
      try {
        let dataUrl = await fileToDataUrl(file);
        if (compress) dataUrl = await compressDataUrl(dataUrl, 1200, 0.8);

        // Preview in chat
        await botui.message.add({
          type: 'html',
          content: `<div class="hint">Voorbeeld van je foto:</div>
                    <img src="${dataUrl}" alt="foto" style="max-width:100%;border-radius:10px;border:1px solid #ddd"/>`
        });

        resolve(dataUrl);
      } catch (e) {
        console.error(e);
        await botui.message.add({ content: 'Oeps, foto laden lukte niet 😕' });
        resolve(null);
      }
    };
  });
  input.click();
  return p;
}

// Exporteer naar window (simpel inladen zonder bundler)
window.ATALIAN_PHOTO = {
  askPhoto, compressDataUrl
};
</script>
