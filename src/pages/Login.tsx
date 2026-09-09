import { useState } from "react";
import { supabase } from "../lib/supabase";

// Reconciles any purchases made before this email ever logged in — turns
// them into entitlements now that a client_id exists. Runs once per login;
// safe to call repeatedly since entitlements are upserted on (client_id,
// product_id). This mirrors what the webhook receiver does for purchases
// that arrive after a client already has an account (plan §6).
async function reconcilePurchases(clientId: string, email: string) {
  const { data: purchases } = await supabase
    .from("purchases")
    .select("id, product_id")
    .ilike("client_email", email);

  if (!purchases?.length) return;

  const { data: relationship } = await supabase
    .from("coaching_relationships")
    .select("id")
    .eq("active", true)
    .ilike("client_email", email)
    .maybeSingle();

  for (const purchase of purchases) {
    await supabase.from("entitlements").upsert(
      {
        client_id: clientId,
        product_id: purchase.product_id,
        coaching_relationship_id: relationship?.id ?? null,
        source: "purchase",
        purchase_id: purchase.id,
      },
      { onConflict: "client_id,product_id" },
    );
  }
}

export function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: window.location.origin + "/portal" },
    });

    if (error) {
      setError("Something went wrong sending your link. Please try again.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="card" style={{ maxWidth: 420, margin: "4rem auto" }}>
        <h2>Check your email</h2>
        <p>
          We sent a login link to <strong>{email}</strong>. Click it to open
          your account.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: "4rem auto" }}>
      <h1>Welcome back</h1>
      {/* Plan §6 — this is the single most important line on this screen.
          It's what prevents most of the "why can't I see my course" support
          requests before they happen. */}
      <p>
        Log in with the <strong>same email you purchased with</strong>.
        That's how we find your courses.
      </p>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: "0.75rem", marginBottom: "1rem" }}
        />
        {error && <p style={{ color: "#b5603a" }}>{error}</p>}
        <button className="btn-primary" type="submit">
          Send me a login link
        </button>
      </form>
      <p style={{ fontSize: "0.875rem", marginTop: "1rem" }}>
        Used a different email at checkout, or not sure which one? Reach out
        and we'll sort it out.
      </p>
    </div>
  );
}

export { reconcilePurchases };
