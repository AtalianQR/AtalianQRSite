// APIConfig.js

// Detectie: als je op index.astro zit (of root), dan productie, anders test
const path = (typeof window !== "undefined" ? window.location.pathname : "");
const IS_PROD = path === "/" || path.includes("index");

// Vul HIER de juiste productiegegevens in!
export const API_KEY = IS_PROD
  ? "JOUW-PRODUCTIE-API-KEY"
  : "03F5BDB822224699AD5077BE481BB627";

export const BASE_URL = IS_PROD
  ? "https://atalian.ultimo.net/api/v1"
  : "https://atalian-test.ultimo.net/api/v1";

// Gebruik duidelijke namen voor ApplicationElementId's:
export const APP_ELEMENT_QueryAtalianJobs = IS_PROD
  ? "PROD-APP-ELEMENT-ID"
  : "6379d9e0a70545a6d90679e46e6ab715";

export const APP_ELEMENT_OneAtalianJob = IS_PROD
  ? "PROD-APP-ELEMENT-ID"
  : "3f92bbfca30445ff875f3a9d956441be";
