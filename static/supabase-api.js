// Supabase mode. The page talks to /api/* at JR_API (index.html). When static/config.json names a Supabase
// project — {"api": "https://<ref>.supabase.co", "supabase_key": "<its publishable/anon key>"} — this answers
// the calls to that address through the yai_* database functions from supabase/schema.sql instead, so the
// page itself doesn't know or care which backend it has. Anything else passes straight through.
(function () {
  const real = window.fetch.bind(window);
  const STORE = "yai_supabase";

  // {origin, key} from config.json. The file is read once per visit (window.JR_CONFIG: the page uses the same answer for the
  // backend's address), but nothing waits for it after a device's first visit: the copy remembered here answers at once, so
  // the first call goes out straight away, and the fresh answer takes over when it arrives. Still known with no signal.
  const shape = (c) => { const k = (c.supabase_key || "").trim(), o = k && c.api ? new URL(c.api).origin : ""; return { origin: o, key: k }; };
  let kept = null;
  try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && typeof s.origin === "string" && typeof s.key === "string") kept = s; } catch (_) {}
  const file = window.JR_CONFIG = real("static/config.json?" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const fresh = file.then((c) => {
    if (!c || typeof c !== "object") return kept || {};
    const now = shape(c);
    try { localStorage.setItem(STORE, JSON.stringify(now)); } catch (_) {}
    confP = Promise.resolve(now);
    return now;
  }).catch(() => kept || {});
  let confP = kept ? Promise.resolve(kept) : fresh;
  const conf = () => confP;
  const key = async () => (await conf()).key || "";
  // whose calendar the page is showing (an admin may look at another account's; see jrOwner in the page): nothing = the signed-in account's own
  const viewing = () => { try { return typeof jrOwner === "function" ? jrOwner() : null; } catch (_) { return null; } };
  const owner = () => { const o = viewing(); return o ? { p_owner: o } : {}; };
  const ownerIn = () => { const o = viewing(); return o ? { owner_id: o } : {}; };

  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const header = (h, name) => !h ? "" : typeof h.get === "function" ? h.get(name) || "" :
    Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1] || "";

  async function rpc(origin, fn, args) {
    const k = await key();
    const headers = { "content-type": "application/json", apikey: k };
    if (k.startsWith("eyJ")) headers.authorization = "Bearer " + k;   // older (JWT) anon keys want both
    const r = await real(`${origin}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
    const d = await r.json().catch(() => null);
    if (!r.ok) return reply({ detail: d?.message || r.statusText }, r.status);
    if (d && typeof d === "object" && !Array.isArray(d) && d.error) return reply({ detail: d.error }, d.status || 400);
    return reply(d);
  }

  async function answer(origin, method, path, body, token) {
    const ev = path.match(/^\/api\/journal\/events\/(\d+)(\/done)?$/);
    if (path === "/api/auth") return rpc(origin, "yai_auth", {});
    if (path === "/api/signup" && method === "POST")
      return rpc(origin, "yai_signup", { p_username: body.username ?? "", p_password: body.password ?? "", p_name: body.name ?? "", p_code: body.code ?? "" });
    if (path === "/api/login" && method === "POST") return rpc(origin, "yai_login", { p_username: body.username ?? "", p_password: body.password ?? "" });
    if (path === "/api/login/code" && method === "POST") return rpc(origin, "yai_login_code", { p_ticket: body.ticket ?? "", p_code: body.code ?? "" });
    if (path === "/api/password" && method === "POST") return rpc(origin, "yai_change_password", { p_token: token, p_current: body.current ?? "", p_new: body.password ?? "" });
    if (path === "/api/totp/begin" && method === "POST") return rpc(origin, "yai_totp_begin", { p_token: token });
    if (path === "/api/totp/confirm" && method === "POST") return rpc(origin, "yai_totp_confirm", { p_token: token, p_code: body.code ?? "" });
    if (path === "/api/totp/disable" && method === "POST") return rpc(origin, "yai_totp_disable", { p_token: token, p_password: body.password ?? "" });
    if (path === "/api/audit") return rpc(origin, "yai_audit", { p_token: token });
    if (path === "/api/logout") return rpc(origin, "yai_logout", { p_token: token });
    if (path === "/api/me") return rpc(origin, "yai_me", { p_token: token });
    if (path === "/api/users" && method === "GET") return rpc(origin, "yai_users", { p_token: token });
    const us = path.match(/^\/api\/users\/(\d+)(\/role)?$/);
    if (us && us[2] && method === "POST") return rpc(origin, "yai_set_role", { p_token: token, p_id: +us[1], p_role: body.role ?? "" });
    const us2 = path.match(/^\/api\/users\/(\d+)\/(password|reset2fa)$/);
    if (us2 && us2[2] === "password" && method === "POST") return rpc(origin, "yai_admin_set_password", { p_token: token, p_id: +us2[1], p_password: body.password ?? "" });
    if (us2 && us2[2] === "reset2fa" && method === "POST") return rpc(origin, "yai_admin_reset_2fa", { p_token: token, p_id: +us2[1] });
    if (us && !us[2] && method === "DELETE") return rpc(origin, "yai_remove_user", { p_token: token, p_id: +us[1] });
    if (path === "/api/people" && method === "POST") return rpc(origin, "yai_add_person", { p_token: token, p_person: body });
    const pe = path.match(/^\/api\/people\/([^/]+)$/);
    if (pe && method === "POST") return rpc(origin, "yai_update_person", { p_token: token, p_code: decodeURIComponent(pe[1]), p_person: body });
    if (pe && method === "DELETE") return rpc(origin, "yai_remove_person", { p_token: token, p_code: decodeURIComponent(pe[1]) });
    const pp = path.match(/^\/api\/people\/([^/]+)\/nickname$/);
    if (pp && method === "POST") return rpc(origin, "yai_set_nickname", { p_token: token, p_code: decodeURIComponent(pp[1]), p_nickname: body.nickname ?? "" });
    if (path === "/api/scan" && method === "POST")
      return functionCall(origin, "scan-event", { token, images: body.images, today: body.today, languages: body.languages });
    if (path === "/api/people") return rpc(origin, "yai_people", { p_token: token });
    // money in / money out (ODJ): the month's rows and totals, add one, delete one
    const mo = path.match(/^\/api\/money\/(\d{4}-\d{2})$/);
    if (mo && method === "GET") return rpc(origin, "yai_money", { p_token: token, p_month: mo[1], ...owner() });
    if (path === "/api/money" && method === "POST") return rpc(origin, "yai_money_add", { p_token: token, p_entry: { ...body, ...ownerIn() } });
    const md = path.match(/^\/api\/money\/(\d+)$/);
    if (md && method === "DELETE") return rpc(origin, "yai_money_delete", { p_token: token, p_id: +md[1] });
    // repeating tasks (ODJ): every day / week / month, ticked off per day
    const tk = path.match(/^\/api\/journal\/tasks\/(\d+)(\/done)?$/);
    if (path === "/api/journal/tasks" && method === "GET") return rpc(origin, "yai_tasks", { p_token: token, ...owner() });
    if (path === "/api/journal/tasks" && method === "POST") return rpc(origin, "yai_task_add", { p_token: token, p_task: { ...body, ...ownerIn() } });
    if (tk && tk[2] && method === "POST") return rpc(origin, "yai_task_done", { p_token: token, p_id: +tk[1], p_day: body.day ?? "", p_done: !!body.done });
    if (tk && method === "POST") return rpc(origin, "yai_task_update", { p_token: token, p_id: +tk[1], p_task: body });
    if (tk && method === "DELETE") return rpc(origin, "yai_task_delete", { p_token: token, p_id: +tk[1] });
    if (path === "/api/journal/events" && method === "GET") return rpc(origin, "yai_events", { p_token: token, ...owner() });
    if (path === "/api/journal/events" && method === "POST") return rpc(origin, "yai_add", { p_token: token, p_event: { ...body, ...ownerIn() } });
    if (path === "/api/journal/import" && method === "POST")
      return rpc(origin, "yai_import", { p_token: token, p_events: Array.isArray(body) ? body : body.events });
    if (ev && method === "DELETE") return rpc(origin, "yai_delete", { p_token: token, p_id: +ev[1] });
    if (ev && ev[2]) return rpc(origin, "yai_done", { p_token: token, p_id: +ev[1], p_done: !!body.done });
    if (ev && method === "POST") return rpc(origin, "yai_update", { p_token: token, p_id: +ev[1], p_patch: body });
    // reminders: the "reminders" Edge Function (supabase/functions/reminders)
    if (path === "/api/push/key") return reminders(origin, { action: "key" });
    if (path === "/api/push/subscribe" && method === "POST")
      return reminders(origin, { action: "subscribe", token, subscription: body.subscription ?? body, test: !!body.test, lang: body.lang });
    if (path === "/api/push/unsubscribe" && method === "POST") return reminders(origin, { action: "unsubscribe", token, endpoint: body.endpoint });
    return reply({ detail: "not available on this backend" }, 404);
  }

  async function functionCall(origin, name, body) {
    const r = await real(`${origin}/functions/v1/${name}`, { method: "POST", headers: { "content-type": "application/json", apikey: await key() }, body: JSON.stringify(body) });
    return reply(await r.json().catch(() => ({ detail: r.statusText })), r.status);
  }

  async function reminders(origin, body) {
    const r = await real(`${origin}/functions/v1/reminders`, { method: "POST", headers: { "content-type": "application/json", apikey: await key() }, body: JSON.stringify(body) });
    // not deployed (yet): 404, and the app doesn't offer reminders
    return reply(await r.json().catch(() => ({ detail: r.statusText })), r.status);
  }

  window.fetch = async function (input, init) {
    let u;
    try { u = new URL(typeof input === "string" ? input : input.url, location.href); } catch (_) { return real(input, init); }
    if (!u.pathname.includes("/api/")) return real(input, init);
    const c = await conf();
    if (!c.key || u.origin !== c.origin || !u.pathname.startsWith("/api/")) return real(input, init);
    let body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (_) {}
    return answer(u.origin, ((init && init.method) || "GET").toUpperCase(), u.pathname, body || {}, header(init && init.headers, "x-token").trim());
  };
})();
