/**
 * ReachOut Answer - Thumbtack Partner API module
 * OAuth (authorization code + refresh) and Business Associate Phone Numbers.
 * Additive: only handles /oauth/thumbtack/* and /api/admin/thumbtack*.
 */
const ENVS = {
  staging: {
    api: "https://staging-api.thumbtack.com/api",
    auth: "https://staging-auth.thumbtack.com/oauth2/auth",
    token: "https://staging-auth.thumbtack.com/oauth2/token"
  },
  production: {
    api: "https://api.thumbtack.com/api",
    auth: "https://auth.thumbtack.com/oauth2/auth",
    token: "https://auth.thumbtack.com/oauth2/token"
  }
};
const DEFAULT_SCOPES = "offline_access supply::users.read supply::businesses.list supply::businesses/associate-phone-numbers.read supply::businesses/associate-phone-numbers.write supply::webhooks.read supply::webhooks.write supply::negotiations.read supply::messages.write";
const TOKEN_KEY = "thumbtack:oauth";
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{24,128}$/;
class HttpError extends Error {
  constructor(status, code, detail) { super(code); this.status = status; this.code = code; this.detail = detail; }
}
function cfg(env) {
  const name = String(env.THUMBTACK_ENV || "").toLowerCase();
  const e = ENVS[name];
  if (!e) throw new HttpError(500, "thumbtack_env_not_set");
  if (!env.THUMBTACK_CLIENT_ID || !env.THUMBTACK_CLIENT_SECRET) throw new HttpError(500, "thumbtack_credentials_missing");
  if (!env.REACHOUT_LEADS) throw new HttpError(500, "REACHOUT_LEADS_not_bound");
  return { name: name, api: e.api, auth: e.auth, token: e.token, scopes: [...new Set(((env.THUMBTACK_SCOPES || DEFAULT_SCOPES) + " supply::messages.write").trim().split(/\s+/))].join(" ") };
}
function redirectUri(env, url) {
  return env.THUMBTACK_REDIRECT_URI || (url.origin + "/oauth/thumbtack/callback");
}
export async function handleThumbtack(request, env, url, deps) {
  try {
    const p = url.pathname;
    if (p === "/oauth/thumbtack/start" && request.method === "GET") return await start(env, url);
    if (p === "/oauth/thumbtack/callback" && request.method === "GET") return await callback(env, url);
    if (p === "/api/admin/thumbtack") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: deps.apiCors() });
      if (request.method !== "POST") return deps.apiJson({ ok: false, error: "method_not_allowed" }, 405);
      if (!deps.checkAuth(request, env)) return deps.apiJson({ ok: false, error: "unauthorized" }, 401);
      let body;
      try { body = await request.json(); } catch { return deps.apiJson({ ok: false, error: "invalid_json" }, 400); }
      return deps.apiJson(await runOp(env, body && body.op, (body && body.args) || {}, deps));
    }
    const t = p.match(/^\/api\/admin\/thumbtack\/ticket\/([A-Za-z0-9_-]{24,128})$/);
    if (t && request.method === "GET") {
      if (!env.REACHOUT_LEADS) throw new HttpError(500, "REACHOUT_LEADS_not_bound");
      const key = "admin_ticket:" + t[1];
      const raw = await env.REACHOUT_LEADS.get(key);
      if (!raw) return deps.json({ ok: false, error: "ticket_invalid_or_used" }, 401);
      await env.REACHOUT_LEADS.delete(key);
      let ticket;
      try { ticket = JSON.parse(raw); } catch { return deps.json({ ok: false, error: "ticket_corrupt" }, 400); }
      if (!ticket.expiresAt || Date.parse(ticket.expiresAt) < Date.now()) return deps.json({ ok: false, error: "ticket_expired" }, 401);
      return deps.json(await runOp(env, ticket.op, ticket.args || {}, deps));
    }
    return deps.json({ ok: false, error: "not_found" }, 404);
  } catch (e) {
    if (e instanceof HttpError) return deps.json({ ok: false, error: e.code, detail: e.detail === undefined ? null : e.detail }, e.status);
    throw e;
  }
}
async function start(env, url) {
  const c = cfg(env);
  const state = url.searchParams.get("state") || "";
  if (!NONCE_RE.test(state)) return page(400, "This connect link is not valid.");
  const raw = await env.REACHOUT_LEADS.get("oauth_state:" + state);
  if (!raw) return page(401, "This connect link has expired or was already used.");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: env.THUMBTACK_CLIENT_ID,
    redirect_uri: redirectUri(env, url),
    scope: c.scopes,
    state: state,
    audience: "urn:partner-api"
  });
  return Response.redirect(c.auth + "?" + q.toString(), 302);
}
async function callback(env, url) {
  const c = cfg(env);
  const state = url.searchParams.get("state") || "";
  if (!NONCE_RE.test(state)) return page(400, "This sign-in response is not valid.");
  const stateKey = "oauth_state:" + state;
  const raw = await env.REACHOUT_LEADS.get(stateKey);
  if (!raw) return page(401, "This connect link has expired or was already used. Ask for a new one.");
  await env.REACHOUT_LEADS.delete(stateKey);
  const err = url.searchParams.get("error");
  if (err) return page(400, "Thumbtack returned an error: " + err + " " + (url.searchParams.get("error_description") || ""));
  const code = url.searchParams.get("code");
  if (!code) return page(400, "Thumbtack did not return an authorization code.");
  try {
    const tok = await tokenRequest(env, c, { grant_type: "authorization_code", code: code, redirect_uri: redirectUri(env, url) });
    await saveTokens(env, c, tok, null);
  } catch (e) {
    if (e instanceof HttpError) return page(502, "Token exchange failed: " + JSON.stringify(e.detail || e.code));
    throw e;
  }
  return page(200, "Thumbtack (" + c.name + ") is connected. You can close this tab.");
}
async function tokenRequest(env, c, params) {
  const attempt = async (mode) => {
    const body = new URLSearchParams(params);
    const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    if (mode === "basic") {
      headers.authorization = "Basic " + btoa(encodeURIComponent(env.THUMBTACK_CLIENT_ID) + ":" + encodeURIComponent(env.THUMBTACK_CLIENT_SECRET));
    } else {
      body.set("client_id", env.THUMBTACK_CLIENT_ID);
      body.set("client_secret", env.THUMBTACK_CLIENT_SECRET);
    }
    const r = await fetch(c.token, { method: "POST", headers: headers, body: body });
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    return { r: r, data: data };
  };
  const first = env.THUMBTACK_TOKEN_AUTH === "post" ? "post" : "basic";
  let res = await attempt(first);
  if (res.r.status === 401 && res.data && res.data.error === "invalid_client") res = await attempt(first === "basic" ? "post" : "basic");
  if (!res.r.ok || !res.data || !res.data.access_token) {
    throw new HttpError(502, "thumbtack_token_error", {
      status: res.r.status,
      error: (res.data && res.data.error) || null,
      description: (res.data && res.data.error_description) || null
    });
  }
  return res.data;
}
async function saveTokens(env, c, tok, prev) {
  const now = new Date().toISOString();
  const rec = {
    env: c.name,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || (prev && prev.refresh_token) || null,
    expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
    scope: tok.scope || (prev && prev.scope) || c.scopes,
    connected_at: (prev && prev.connected_at) || now,
    refreshed_at: now
  };
  await env.REACHOUT_LEADS.put(TOKEN_KEY, JSON.stringify(rec));
  return rec;
}
async function readTokens(env) {
  const raw = await env.REACHOUT_LEADS.get(TOKEN_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function accessToken(env, c) {
  const rec = await readTokens(env);
  if (!rec) throw new HttpError(409, "thumbtack_not_connected");
  if (rec.env !== c.name) throw new HttpError(409, "thumbtack_connected_to_other_env");
  if (rec.expires_at - Date.now() > 120000) return rec.access_token;
  if (!rec.refresh_token) throw new HttpError(409, "thumbtack_reconnect_required");
  const tok = await tokenRequest(env, c, { grant_type: "refresh_token", refresh_token: rec.refresh_token });
  return (await saveTokens(env, c, tok, rec)).access_token;
}
async function tt(env, c, method, path, body, query) {
  if (!/^\/v4\/[A-Za-z0-9\/_.-]+$/.test(path) || path.indexOf("..") >= 0) throw new HttpError(400, "invalid_thumbtack_path");
  let qs = "";
  if (query && typeof query === "object") {
    const q = new URLSearchParams();
    for (const k of Object.keys(query)) q.set(k, String(query[k]));
    qs = q.toString() ? "?" + q.toString() : "";
  }
  const token = await accessToken(env, c);
  const headers = { authorization: "Bearer " + token, accept: "application/json" };
  if (body) headers["content-type"] = "application/json";
  const r = await fetch(c.api + path + qs, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text.slice(0, 2000); }
  return { ok: r.ok, status: r.status, data: data };
}
function businessId(args) {
  const v = String(args.businessID || "");
  if (!ID_RE.test(v)) throw new HttpError(400, "invalid_businessID");
  return v;
}
function phoneNumberId(args) {
  const v = String(args.phoneNumberID || "");
  if (!ID_RE.test(v)) throw new HttpError(400, "invalid_phoneNumberID");
  return v;
}
export function normalizePhone(v) {
  const s = String(v || "").trim();
  const digits = s.replace(/\D/g, "");
  let out;
  if (!s.startsWith("+") && digits.length === 10) out = "+1" + digits;
  else out = "+" + digits;
  if (!/^\+[1-9]\d{7,14}$/.test(out)) throw new HttpError(400, "invalid_phoneNumber");
  return out;
}
function phoneLabel(v) {
  const s = String(v || "Business line").trim();
  if (!s || s.length > 100) throw new HttpError(400, "invalid_name");
  return s;
}
async function runOp(env, op, args, deps) {
  const c = cfg(env);
  const base = () => "/v4/businesses/" + businessId(args) + "/associate-phone-numbers";
  switch (op) {
    case "status": {
      const rec = await readTokens(env);
      return {
        ok: true, env: c.name, connected: !!rec && rec.env === c.name,
        scope: rec ? rec.scope : null, connectedAt: rec ? rec.connected_at : null,
        accessTokenExpiresAt: rec ? new Date(rec.expires_at).toISOString() : null,
        hasRefreshToken: !!(rec && rec.refresh_token), requestedScopes: c.scopes
      };
    }
    case "get":
      return { ok: true, result: await tt(env, c, "GET", String(args.path || ""), null, args.query) };
    case "phone_list":
      return { ok: true, result: await tt(env, c, "GET", base()) };
    case "phone_create":
      return { ok: true, result: await tt(env, c, "POST", base(), { phoneNumber: normalizePhone(args.phoneNumber), name: phoneLabel(args.name) }) };
    case "phone_update":
      return { ok: true, result: await tt(env, c, "PUT", base() + "/" + phoneNumberId(args), { phoneNumber: normalizePhone(args.phoneNumber), name: phoneLabel(args.name) }) };
    case "phone_delete":
      return { ok: true, result: await tt(env, c, "DELETE", base() + "/" + phoneNumberId(args)) };
    case "replay_webhooks": {
      if (c.name !== "staging") throw new HttpError(403, "staging_only");
      const keys = Array.isArray(args.keys) ? args.keys.slice(0, 30) : [];
      const out = [];
      for (const key of keys) {
        if (!/^replay:[A-Za-z0-9_-]{1,80}$/.test(String(key))) throw new HttpError(400, "invalid_key");
        const body = await env.REACHOUT_LEADS.get(String(key));
        if (!body) { out.push({ key, error: "not_found" }); continue; }
        const res = await deps.receiveThumbtack(new Request("https://staging.invalid/webhooks/thumbtack", { method: "POST", headers: { "content-type": "application/json" }, body }), env);
        out.push({ key, result: await res.json() });
      }
      return { ok: true, replayed: out };
    }
    default:
      throw new HttpError(400, "unknown_op");
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function page(status, message) {
  const html = "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>ReachOut Answer</title>" +
    "<body style=\"font-family:system-ui;max-width:560px;margin:15vh auto;padding:0 16px\"><h2>ReachOut Answer</h2><p>" + escapeHtml(message) + "</p></body>";
  return new Response(html, { status: status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
