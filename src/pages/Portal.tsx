import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Product = {
  id: string;
  slug: string;
  title: string;
  type: string;
  description: string | null;
  tool_path: string | null;
  related_product_ids: string[];
};

type Entitlement = { product_id: string; products: Product };

export function Portal() {
  const [email, setEmail] = useState("");
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [upsells, setUpsells] = useState<{ id: string; title: string; slug: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setEmail(user.email ?? "");

      // Server-side: creates my client row and turns any purchases made with my
      // email (plus anything bundled with them) into entitlements.
      const { error: reconcileErr } = await supabase.rpc("reconcile_my_entitlements");
      if (reconcileErr) console.error("Entitlement reconciliation failed:", reconcileErr);

      const { data: ents, error: entsErr } = await supabase
        .from("entitlements")
        .select("product_id, products(id, slug, title, type, description, tool_path, related_product_ids)")
        .eq("client_id", user.id)
        .is("revoked_at", null);

      if (entsErr) {
        console.error("Failed to load entitlements:", entsErr);
        setLoadError("We couldn't load your courses just now. Please refresh in a moment.");
        setLoading(false);
        return;
      }

      const all = ((ents as any) ?? []).filter((e: Entitlement) => e.products) as Entitlement[];
      setEntitlements(all);

      // Curated upsells only: related products the client doesn't already own.
      const ownedIds = new Set(all.map((e) => e.product_id));
      const relatedIds = Array.from(new Set(all.flatMap((e) => e.products.related_product_ids ?? []))).filter(
        (id) => !ownedIds.has(id),
      );
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

  async function logOut() {
    await supabase.auth.signOut();
  }

  if (loading) return <p style={{ textAlign: "center", marginTop: "4rem" }}>Loading your courses…</p>;

  // A coaching package only exists to grant the things bundled with it,
  // so it isn't shown as a card of its own.
  const visible = entitlements.filter((e) => e.products.type !== "coaching_package");

  return (
    <div style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem" }}>
        <h1>Your Coacherie</h1>
        <div style={{ fontSize: "0.85rem", color: "var(--color-walnut)", textAlign: "right" }}>
          {email && <div>{email}</div>}
          <button
            onClick={logOut}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--color-walnut)",
              textDecoration: "underline",
              font: "inherit",
            }}
          >
            Log out
          </button>
        </div>
      </div>

      <h2>Your courses</h2>
      {loadError && <p>{loadError}</p>}
      {!loadError && visible.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>
            Nothing here yet. If you just purchased, it can take up to 20 minutes to show up — check back shortly.
          </p>
        </div>
      )}
      <div style={{ display: "grid", gap: "1rem" }}>
        {visible.map((e) => (
          <div className="card" key={e.product_id}>
            <h3 style={{ marginTop: 0 }}>{e.products.title}</h3>
            {e.products.description && <p>{e.products.description}</p>}
            {e.products.tool_path && (
              <Link
                to={`/tools/${e.products.slug}`}
                className="btn-primary"
                style={{ display: "inline-block", textDecoration: "none" }}
              >
                Open
              </Link>
            )}
          </div>
        ))}
      </div>

      {upsells.length > 0 && (
        <>
          <h2 style={{ marginTop: "2rem" }}>You might also like</h2>
          <div style={{ display: "grid", gap: "1rem" }}>
            {upsells.map((p) => (
              <div className="card" key={p.id}>
                <h3 style={{ marginTop: 0 }}>{p.title}</h3>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
