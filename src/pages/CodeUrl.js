// --- QR-code parsing ---
export function parseUltimoQR(code) {
  if (!/^\d{8,20}$/.test(code)) return null; // accepteer 8-20 cijfers
  const indicator = code.slice(-1);
  const isEquipment = indicator === '9';
  const typeStr = isEquipment ? 'eq' : 'sp';
  let id = '';
  for (let i = 0; i < code.length - 1; i += 2) id += code[i];
  return { isEquipment, typeStr, id, indicator, originalCode: code };
}