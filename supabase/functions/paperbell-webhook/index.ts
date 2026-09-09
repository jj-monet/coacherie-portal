import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventId: string | undefined = payload.event_id ?? payload.id;
  const buyerEmail: string | undefined = payload.customer?.email ?? payload.email;
  const paperbellProductId: string | undefined = payload.product?.id ?? payload.product_id;

  if (!eventId || !buyerEmail || !paperbellProductId) {
    return new Response("Missing required fields", { status: 400 });
  }

  // Product mapping now lives in the database (products.paperbell_product_id)
  // instead of hardcoded here — adding a new product later just means adding
  // a row, not editing and redeploying this function.
  const { data: product, error: productErr } = await supabase
    .from("products")
    .select("id")
    .eq("paperbell_product_id", paperbellProductId)
    .single();

  if (productErr || !product) {
    console.error(`Unmapped Paperbell product id: ${paperbellProductId}`);
    return new Response("Unmapped product", { status: 422 });
  }

  const { data: purchase, error: purchaseErr } = await supabase
    .from("purchases")
    .insert({
      client_email: buyerEmail,
      product_id: product.id,
      source: "paperbell",
      webhook_event_id: eventId,
      raw_payload: payload,
    })
    .select("id")
    .single();

  if (purchaseErr) {
    if (purchaseErr.code === "23505") {
      return new Response("Already processed", { status: 200 });
    }
    console.error("Purchase insert failed", purchaseErr);
    return new Response("Internal error", { status: 500 });
  }

  const { data: relationship } = await supabase
    .from("coaching_relationships")
    .select("id")
    .eq("active", true)
    .ilike("client_email", buyerEmail)
    .maybeSingle();

  const { data: existingClient } = await supabase
    .from("clients")
    .select("id")
    .eq("email", buyerEmail)
    .maybeSingle();

  if (existingClient) {
    const { error: entitlementErr } = await supabase.from("entitlements").upsert(
      {
        client_id: existingClient.id,
        product_id: product.id,
        coaching_relationship_id: relationship?.id ?? null,
        source: "purchase",
        purchase_id: purchase.id,
      },
      { onConflict: "client_id,product_id" },
    );
    if (entitlementErr) {
      console.error("Entitlement upsert failed", entitlementErr);
      return new Response("Internal error", { status: 500 });
    }
  }

  return new Response("OK", { status: 200 });
});
