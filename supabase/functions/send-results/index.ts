import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Emails a client's tool results to the coach. Called by the portal on the
// client's behalf. Deployed with --no-verify-jwt: we check the login ourselves below.
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const COACH_EMAIL = Deno.env.get("COACH_EMAIL") ?? "thecoacherie@proton.me";
const FROM = Deno.env.get("SEND_FROM") ?? "The Coacherie <noreply@mail.thecoacherie.com>";
const MAX_BODY = 20000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // 1. Must be a signed-in user (not just anyone holding the public key).
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Not signed in" });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user || !user.email) return json(401, { error: "Not signed in" });

  // 2. Validate the message.
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  const slug = String(payload.slug ?? "");
  const subject = String(payload.subject ?? "").replace(/[\r\n]+/g, " ").slice(0, 150);
  const body = String(payload.body ?? "");
  if (!slug || !subject || !body.trim()) return json(400, { error: "Missing fields" });
  if (body.length > MAX_BODY) return json(413, { error: "Message too long" });

  // 3. Must actually own the tool they're sending from.
  const { data: owned, error: ownedErr } = await admin
    .from("entitlements")
    .select("id, products!inner(slug)")
    .eq("client_id", user.id)
    .is("revoked_at", null)
    .eq("products.slug", slug)
    .limit(1);
  if (ownedErr) {
    console.error("Entitlement check failed", ownedErr);
    return json(500, { error: "Could not verify access" });
  }
  if (!owned || owned.length === 0) return json(403, { error: "No access" });

  // 4. Send.
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error("RESEND_API_KEY is not set");
    return json(500, { error: "Email is not configured" });
  }

  const text = `From: ${user.email}\nTool: ${slug}\nSent: ${new Date().toISOString()}\n\n${body}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [COACH_EMAIL],
      reply_to: user.email,
      subject: `[Portal] ${subject} — ${user.email}`,
      text,
    }),
  });
  if (!res.ok) {
    console.error("Resend failed", res.status, await res.text());
    return json(502, { error: "Send failed" });
  }
  return json(200, { ok: true });
});
