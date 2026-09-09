import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { reconcilePurchases } from "./Login";

type Entitlement = {
  product_id: string;
  products: { id: string; slug: string; title: string; type: string; related_product_ids: string[] };
};

type ProgressRow = {
  product_id: string;
  unit_id: string;
  opened_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export function Portal() {
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [upsells, setUpsells] = useState<{ id: string; title: string; slug: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Reconcile any purchases made before this account existed.
      await reconcilePurchases(user.id, user.email!);

      const { data: ents } = await supabase
        .from("entitlements")
        .select("product_id, products(id, slug, title, type, related_product_ids)")
        .eq("client_id", user.id)
        .is("revoked_at", null);

      const { data: prog } = await supabase
        .from("progress")
        .select("product_id, unit_id, opened_at, completed_at, updated_at")
        .eq("client_id", user.id)
        .order("updated_at", { ascending: false });

      setEntitlements((ents as any) ?? []);
      setProgress(prog ?? []);

      // Curated upsells only — related_product_ids the client doesn't already
      // own. Never the full catalog (plan §12): relatedness must be
      // deliberate, not inferred.
      const ownedIds = new Set((ents ?? []).map((e: any) => e.product_id));
      const relatedIds = Array.from(
        new Set((ents ?? []).flatMap((e: any) => e.products?.related_product_ids ?? [])),
      ).filter((id) => !ownedIds.has(id));

      if (relatedIds.length) {
        const { data: related } = await supabase
          .from("products")
          .select("id, title, slug")
          .in("id", relatedIds)
          .eq("active", true);
        setUpsells(related ?? []);
      }

      setLoading(false);
    })();
  }, []);

  if (loading) return <p>Loading your courses…</p>;

  const mostRecentInProgress = progress.find((p) => p.opened_at && !p.completed_at);

  return (
    <div style={{ maxWidth: 720, margin: "2rem auto" }}>
      <h1>Your Coacherie</h1>

      {mostRecentInProgress && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h3>Continue where you left off</h3>
          <p>{mostRecentInProgress.unit_id}</p>
          <button className="btn-primary">Resume</button>
        </div>
      )}

      <h2>Your courses</h2>
      <div style={{ display: "grid", gap: "1rem" }}>
        {entitlements.map((e) => (
          <div className="card" key={e.product_id}>
            <h3>{e.products.title}</h3>
            {/* TODO: session progress summary, e.g. "Session 3 of 5" */}
          </div>
        ))}
      </div>

      {upsells.length > 0 && (
        <>
          <h2 style={{ marginTop: "2rem" }}>You might also like</h2>
          <div style={{ display: "grid", gap: "1rem" }}>
            {upsells.map((p) => (
              <div className="card" key={p.id}>
                <h3>{p.title}</h3>
                <button className="btn-primary">Learn more</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
