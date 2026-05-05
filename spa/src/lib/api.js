// Tomato Tracker GAS API client. Same shape as the ward-music form: POST to
// /exec with `Content-Type: text/plain;charset=utf-8` so the request stays a
// CORS "simple request" — that's the only shape that survives GAS's 302
// redirect to script.googleusercontent.com without preflight failures.
//
// Token + URL come from build-time env (Vite VITE_*). Each form bundle bakes
// in only the token its identity is allowed to use, so a leaked harvest
// bundle can't dump the claim log and vice versa.

const API_URL = import.meta.env.VITE_GAS_API_URL;

async function call(action, token, args = []) {
  if (!API_URL) throw new Error('VITE_GAS_API_URL not set');
  if (!token) throw new Error('bypass token not set');
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token, args }),
    redirect: 'follow',
  });
  let parsed;
  try { parsed = await resp.json(); }
  catch { throw new Error(`bad JSON from API (${resp.status})`); }
  if (!parsed.ok) {
    const err = new Error(parsed.error || JSON.stringify(parsed));
    err.code = parsed.code;
    throw err;
  }
  return parsed.result;
}

const HARVEST_TOKEN = import.meta.env.VITE_HARVEST_TOKEN;

export const ping = () => call('ping', HARVEST_TOKEN);
export const listVarieties = () => call('listVarieties', HARVEST_TOKEN);
export const submitHarvest = (payload) => call('submitHarvest', HARVEST_TOKEN, [payload]);
