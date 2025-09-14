// test.js
import fetch from "node-fetch";

const url = "https://atalian-logs.atalianqr.workers.dev/health";

const res = await fetch(url);
const data = await res.json();
console.log(data);
