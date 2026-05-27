// Supabase Edge Function: search
//
// Embeds a free-text query via the runtime's built-in gte-small model, then
// kNN-searches the user's file_embeddings using pgvector (match_files RPC).
//
// Request:  POST { user_id: uuid, query: string, limit?: number, threshold?: number }
// Response: { results: [{ file_id, file_name, similarity, subjects }] }
//
// JWT verification is OFF — the caller (main backend) is trusted and supplies
// the user_id. Never call this directly from a browser.

import { createClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
declare const Supabase: any;

let embedSession: { run: (input: string, opts: { mean_pool: boolean; normalize: boolean }) => Promise<number[]> } | null = null;
const getEmbedder = () => {
  if (!embedSession) embedSession = new Supabase.ai.Session("gte-small");
  return embedSession!;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  }

  let body: { user_id?: string; query?: string; limit?: number; threshold?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400 });
  }

  const userId = body.user_id?.trim();
  const query = body.query?.trim();
  if (!userId || !query) {
    return new Response(JSON.stringify({ error: "user_id and query required" }), { status: 400 });
  }

  const limit = Math.min(Math.max(body.limit ?? 12, 1), 50);
  const threshold = body.threshold ?? 0.35;

  try {
    const vec = await getEmbedder().run(query.slice(0, 4000), { mean_pool: true, normalize: true });
    if (!Array.isArray(vec) || vec.length !== 384) {
      return new Response(JSON.stringify({ error: "embed failed" }), { status: 500 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: matches, error } = await supabase.rpc("match_files", {
      query_embedding: vec,
      match_threshold: threshold,
      match_count: limit,
      target_user_id: userId,
      exclude_ids: [],
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    type Match = { file_id: string; file_name: string; similarity: number };
    const matchList = (matches ?? []) as Match[];
    const ids = matchList.map((m) => m.file_id);

    // Hydrate with subjects + file_type for richer result cards.
    let extras: Record<string, { subjects: string[] | null; file_type: string | null }> = {};
    if (ids.length > 0) {
      const { data: rows } = await supabase
        .from("files")
        .select("id, subjects, file_type")
        .eq("user_id", userId)
        .in("id", ids);
      type Row = { id: string; subjects: string[] | null; file_type: string | null };
      extras = Object.fromEntries((rows ?? []).map((r: Row) => [r.id, { subjects: r.subjects, file_type: r.file_type }]));
    }

    const results = matchList.map((m) => ({
      file_id: m.file_id,
      file_name: m.file_name,
      similarity: Math.round(m.similarity * 1000) / 1000,
      subjects: extras[m.file_id]?.subjects ?? [],
      file_type: extras[m.file_id]?.file_type ?? null,
    }));

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
