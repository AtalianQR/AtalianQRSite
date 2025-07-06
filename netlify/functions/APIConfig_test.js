// APIConfig_test.js

export const API_KEY = "03F5BDB822224699AD5077BE481BB627";
export const BASE_URL = "https://atalian-test.ultimo.net/api/v1";

// Gebruik duidelijke namen voor ApplicationElementId's:
export const APP_ELEMENT_QueryAtalianJobs = "6379d9e0a70545a6d90679e46e6ab715";
export const APP_ELEMENT_OneAtalianJob = "3f92bbfca30445ff875f3a9d956441be";
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