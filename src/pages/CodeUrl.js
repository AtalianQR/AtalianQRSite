// --- QR-code parsing ---
export function parseUltimoQR(code) {
  if (!/^\d{13}$/.test(code)) return null;
  const indicator = code.slice(-1);
  const isEquipment = indicator === '9';
  const typeStr = isEquipment ? 'eq' : 'sp';
  let id = '';
  for (let i = 0; i < 12; i += 2) id += code[i];
  return {
    isEquipment,
    typeStr,
    id,
    indicator,
    originalCode: code
  };
}