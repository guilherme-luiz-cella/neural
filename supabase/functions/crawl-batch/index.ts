// Supabase Edge Function: crawl-batch (v3 — small batch, background task)
//
// Per-user isolation: every query filters by user_id. Sweep mode only
// iterates users with an active crawler_jobs row.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { strFromU8, unzipSync } from "npm:fflate@0.8";
import { extractText, getDocumentProxy } from "npm:unpdf@1";

// deno-lint-ignore no-explicit-any
declare const Supabase: any;
// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

const BATCH = Number(Deno.env.get("CRAWL_BATCH") ?? "5");
const CONCURRENCY = Number(Deno.env.get("CRAWL_CONCURRENCY") ?? "2");
const SEM_THRESHOLD = 0.55;
const TOPK = 30;
const MAX_CONTENT = 60_000;
const MAX_EMBED_CHARS = 4_000;
const MAX_DOWNLOAD_BYTES = 4_000_000;

const UNCRAWLABLE_PREFIXES = ["image/", "video/", "audio/"];
const UNCRAWLABLE_EXACT = new Set([
  "application/vnd.google-apps.folder",
  "application/vnd.google-apps.shortcut",
  "application/zip", "application/gzip", "application/x-tar",
  "application/x-rar-compressed", "application/x-7z-compressed",
]);
const isCrawlable = (mime: string | null): boolean => {
  if (!mime) return false;
  if (UNCRAWLABLE_EXACT.has(mime)) return false;
  return !UNCRAWLABLE_PREFIXES.some((p) => mime.startsWith(p));
};

const EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/pdf": "__download__",
  "text/plain": "__download__", "text/csv": "__download__",
  "text/html": "__download__", "text/markdown": "__download__",
  "application/json": "__download__", "application/xml": "__download__",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "__download__",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "__download__",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "__download__",
};

const isBinaryReadable = (mime: string): boolean =>
  mime.startsWith("text/") || mime.startsWith("application/") || mime.startsWith("font/");

const decodeText = (buf: ArrayBuffer): string => new TextDecoder("utf-8").decode(buf);
const stripMarkup = (s: string): string =>
  s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const extractReadableStrings = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  const chunks: string[] = [];
  let cur = "";
  for (const b of bytes) {
    if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
    else { if (cur.length >= 4) chunks.push(cur); cur = ""; }
  }
  if (cur.length >= 4) chunks.push(cur);
  return chunks.filter((c) => /[a-zA-Z]/.test(c)).join(" ").replace(/\s+/g, " ");
};

const extractPdf = async (buf: ArrayBuffer): Promise<string> => {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const r = await extractText(pdf, { mergePages: true });
    return typeof r.text === "string" ? r.text : Array.isArray(r.text) ? r.text.join("\n") : "";
  } catch { return extractReadableStrings(buf); }
};

const extractOpenXml = (buf: ArrayBuffer, mime: string): string => {
  try {
    const zip = unzipSync(new Uint8Array(buf));
    const entries = Object.entries(zip).filter(([p]) => {
      if (mime.includes("wordprocessingml")) return p === "word/document.xml";
      if (mime.includes("presentationml")) return /^ppt\/slides\/slide\d+\.xml$/.test(p);
      if (mime.includes("spreadsheetml")) return p === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(p);
      return false;
    });
    return entries.map(([, d]) => stripMarkup(strFromU8(d))).join("\n");
  } catch { return ""; }
};

const extractByMime = async (buf: ArrayBuffer, mime: string): Promise<string> => {
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml") {
    const txt = decodeText(buf);
    return mime.includes("html") || mime.includes("xml") ? stripMarkup(txt) : txt;
  }
  if (mime === "application/pdf") return await extractPdf(buf);
  if (mime.includes("officedocument")) return extractOpenXml(buf, mime);
  return extractReadableStrings(buf);
};

type DriveMeta = { name?: string; description?: string; mimeType?: string };
const fetchMeta = async (id: string, token: string): Promise<DriveMeta> => {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,description,mimeType`, { headers: { Authorization: `Bearer ${token}` } });
  return r.ok ? await r.json() : {};
};
const metaToText = (m: DriveMeta): string => [m.name, m.description, m.mimeType].filter(Boolean).join("\n");
const normalize = (parts: Array<string | null | undefined>): string | null => {
  const out = parts.filter((p): p is string => Boolean(p?.trim())).map((p) => p.trim()).join("\n\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_CONTENT);
  return out.length > 0 ? out : null;
};

const fetchFileContent = async (id: string, mime: string, token: string): Promise<string | null> => {
  const explicit = EXPORT_MIME[mime];
  const mode = explicit ?? (mime.startsWith("text/") || isBinaryReadable(mime) ? "__download__" : undefined);
  const meta = await fetchMeta(id, token);
  if (!mode) return normalize([metaToText(meta)]);
  const url = mode === "__download__"
    ? `https://www.googleapis.com/drive/v3/files/${id}?alt=media`
    : `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(mode)}`;
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (mode === "__download__") headers["Range"] = `bytes=0-${MAX_DOWNLOAD_BYTES - 1}`;
    const r = await fetch(url, { headers });
    if (!r.ok) return normalize([metaToText(meta)]);
    const content = mode === "__download__" ? await extractByMime(await r.arrayBuffer(), mime) : await r.text();
    return normalize([metaToText(meta), content]);
  } catch { return normalize([metaToText(meta)]); }
};

const refreshAccessToken = async (refreshToken: string, clientId: string, clientSecret: string) => {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!r.ok) throw new Error(`DRIVE_REFRESH_FAILED:${r.status}`);
  return await r.json() as { access_token: string; expires_in: number };
};

const getValidAccessToken = async (supabase: SupabaseClient, userId: string, clientId: string, clientSecret: string): Promise<string> => {
  const { data: auth } = await supabase.from("google_drive_auth").select("access_token, refresh_token, expires_at").eq("user_id", userId).maybeSingle();
  if (!auth) throw new Error("DRIVE_NOT_CONNECTED");
  if (new Date(auth.expires_at) > new Date()) return auth.access_token;
  if (!auth.refresh_token) throw new Error("DRIVE_SESSION_EXPIRED");
  const refreshed = await refreshAccessToken(auth.refresh_token, clientId, clientSecret);
  const expires_at = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supabase.from("google_drive_auth").update({ access_token: refreshed.access_token, expires_at }).eq("user_id", userId);
  return refreshed.access_token;
};

const STOP = new Set(["that","this","with","from","have","been","were","they","their","about","which","would","could","should","there","these","other","more","into","than","also","after","before","because","while","such","where","when","each","just","over","very","most","some","many","much","thus","them","the","and","for","are","you","all","but","can","her","was","one","our","out","day","get","has","him","his","how","its","may","old","see","she","two","way","who","boy","did","let","put","say","too","use","any","now","new","why","not","yes","off","per","via","yet"]);
const tokenize = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
const bigrams = (toks: string[]): string[] => { const out: string[] = []; for (let i = 0; i < toks.length - 1; i++) { if (toks[i].length >= 4 && toks[i + 1].length >= 4) out.push(`${toks[i]} ${toks[i + 1]}`); } return out; };
const computeSubjects = (content: string, limit = 24): string[] => {
  if (!content) return [];
  const toks = tokenize(content); if (toks.length === 0) return [];
  const bg = bigrams(toks);
  const counts = new Map<string, number>();
  for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const b of bg) counts.set(b, (counts.get(b) ?? 0) + 1.5);
  const docLen = toks.length;
  const scored = new Map<string, number>();
  for (const [term, c] of counts) scored.set(term, Math.log(1 + c) / Math.log(1 + docLen));
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
};

let embedSession: { run: (input: string, opts: { mean_pool: boolean; normalize: boolean }) => Promise<number[]> } | null = null;
const getEmbedder = () => { if (!embedSession) embedSession = new Supabase.ai.Session("gte-small"); return embedSession!; };
const embed = async (text: string): Promise<number[] | null> => {
  if (!text || !text.trim()) return null;
  try {
    const truncated = text.slice(0, MAX_EMBED_CHARS);
    const vec = await getEmbedder().run(truncated, { mean_pool: true, normalize: true });
    if (!Array.isArray(vec) || vec.length !== 384) return null;
    return vec;
  } catch (e) { console.error("embed failed:", e); return null; }
};

// Concurrency on free plan triggers WORKER_RESOURCE_LIMIT — keep small.
const runPool = async <T>(items: T[], limit: number, worker: (x: T) => Promise<void>): Promise<void> => {
  let cursor = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (cursor < items.length) { const i = cursor++; try { await worker(items[i]); } catch (e) { console.error("worker err", e); } }
  }));
};

type CrawlResult = { crawled: number; connections: number; remaining: number };

const crawlUser = async (supabase: SupabaseClient, userId: string, clientId: string, clientSecret: string): Promise<CrawlResult> => {
  const accessToken = await getValidAccessToken(supabase, userId, clientId, clientSecret);
  const { data: pending, error } = await supabase.from("files").select("id, file_name, file_type, google_drive_id").eq("user_id", userId).is("content", null).not("google_drive_id", "is", null).not("file_type", "is", null).limit(200);
  if (error) throw new Error(error.message);
  type Row = { id: string; file_name: string; file_type: string | null; google_drive_id: string | null };
  const candidates: Row[] = (pending ?? []).filter((f: Row) => isCrawlable(f.file_type));
  if (candidates.length === 0) return { crawled: 0, connections: 0, remaining: 0 };
  const toFetch = candidates.slice(0, BATCH);
  const remaining = Math.max(0, candidates.length - toFetch.length);
  type Embedded = { id: string; file_name: string; embedding: number[] };
  const embedded: Embedded[] = [];
  let crawled = 0;
  await runPool(toFetch, CONCURRENCY, async (f) => {
    if (!f.google_drive_id || !f.file_type) return;
    const content = await fetchFileContent(f.google_drive_id, f.file_type, accessToken);
    if (!content || !content.trim()) return;
    const subjects = computeSubjects(content);
    const embedding = await embed(`${f.file_name}\n${content}`);
    await supabase.from("files").update({ content, subjects, subjects_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", f.id);
    if (embedding) {
      await supabase.from("file_embeddings").upsert({ file_id: f.id, embedding_vector: embedding, status: "indexed", indexed_at: new Date().toISOString(), error_message: null }, { onConflict: "file_id" });
      embedded.push({ id: f.id, file_name: f.file_name, embedding });
    } else {
      await supabase.from("file_embeddings").upsert({ file_id: f.id, status: "failed", error_message: "embed returned null", indexed_at: new Date().toISOString() }, { onConflict: "file_id" });
    }
    crawled++;
  });
  if (embedded.length === 0) return { crawled, connections: 0, remaining };
  type Conn = { file_1_id: string; file_2_id: string; similarity_score: number; created_by: string; connection_type: string };
  const conns: Conn[] = [];
  const seen = new Set<string>();
  const newIds = embedded.map((e) => e.id);
  for (const fresh of embedded) {
    const { data: matches, error: rpcErr } = await supabase.rpc("match_files", {
      query_embedding: fresh.embedding, match_threshold: SEM_THRESHOLD, match_count: TOPK,
      target_user_id: userId, exclude_ids: newIds,
    });
    if (rpcErr) { console.error("match_files err", rpcErr); continue; }
    for (const m of (matches ?? []) as { file_id: string; similarity: number }[]) {
      const key = fresh.id < m.file_id ? `${fresh.id}|${m.file_id}` : `${m.file_id}|${fresh.id}`;
      if (seen.has(key)) continue; seen.add(key);
      conns.push({ file_1_id: fresh.id, file_2_id: m.file_id, similarity_score: Math.round(m.similarity * 1000) / 1000, created_by: "crawler", connection_type: "semantic" });
    }
  }
  const cosine = (a: number[], b: number[]): number => { let dot = 0; for (let i = 0; i < a.length; i++) dot += a[i] * b[i]; return dot; };
  for (let i = 0; i < embedded.length; i++) {
    for (let j = i + 1; j < embedded.length; j++) {
      const sim = cosine(embedded[i].embedding, embedded[j].embedding);
      if (sim < SEM_THRESHOLD) continue;
      const a = embedded[i].id, b = embedded[j].id;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key)) continue; seen.add(key);
      conns.push({ file_1_id: a, file_2_id: b, similarity_score: Math.round(sim * 1000) / 1000, created_by: "crawler", connection_type: "semantic" });
    }
  }
  if (newIds.length > 0) await supabase.from("connections").delete().in("file_1_id", newIds).eq("created_by", "crawler");
  let connCreated = 0;
  if (conns.length > 0) { const { data: ins } = await supabase.from("connections").insert(conns).select("id"); connCreated = ins?.length ?? 0; }
  return { crawled, connections: connCreated, remaining };
};

const advanceJob = async (supabase: SupabaseClient, userId: string, delta: number, done: boolean): Promise<void> => {
  const { data: job } = await supabase.from("crawler_jobs").select("id, processed_files").eq("user_id", userId).in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!job) return;
  const patch: Record<string, unknown> = { processed_files: (job.processed_files ?? 0) + delta };
  if (done) { patch.status = "completed"; patch.completed_at = new Date().toISOString(); }
  await supabase.from("crawler_jobs").update(patch).eq("id", job.id);
};

// Background runner: process one user's batch, then ack.
const processOneUser = async (uid: string, supabase: SupabaseClient, gid: string, gsec: string) => {
  try {
    const r = await crawlUser(supabase, uid, gid, gsec);
    await advanceJob(supabase, uid, r.crawled, r.remaining === 0);
    console.log(`[bg] user=${uid.slice(0,8)} crawled=${r.crawled} conns=${r.connections} remaining=${r.remaining}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "DRIVE_NOT_CONNECTED" || msg.startsWith("DRIVE_REFRESH_FAILED")) {
      await supabase.from("crawler_jobs").update({ status: "cancelled", error_message: msg, completed_at: new Date().toISOString() }).eq("user_id", uid).in("status", ["queued", "running"]);
    }
    console.error("[bg] err", uid.slice(0,8), msg);
  }
};

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return new Response(JSON.stringify({ error: "missing Google secrets" }), { status: 500 });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let body: { user_id?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  let userIds: string[];
  if (body.user_id) { userIds = [body.user_id]; }
  else {
    const { data: jobs } = await supabase.from("crawler_jobs").select("user_id").in("status", ["queued", "running"]);
    userIds = [...new Set((jobs ?? []).map((r: { user_id: string }) => r.user_id))];
  }
  if (userIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, users: 0, message: "no active jobs" }), { headers: { "Content-Type": "application/json" } });
  }
  // EdgeRuntime.waitUntil: keep isolate alive up to 150s (free) while
  // background processing runs. Response returns immediately.
  for (const uid of userIds) {
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(processOneUser(uid, supabase, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET));
    } else {
      await processOneUser(uid, supabase, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    }
  }
  return new Response(JSON.stringify({ ok: true, users: userIds.length, message: "processing in background" }), { headers: { "Content-Type": "application/json" } });
});
