import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// First-pass coach dashboard (plan §13). Everything here relies on RLS —
// these queries only return data if the logged-in user is in the `coaches`
// table, and the shared_with_coach / visible_to_coach filters are enforced
// at the database layer, not just hidden in the UI. That matters: this
// component could have a bug and still not leak anything a client hasn't
// opted to share.

type ClientRow = {
  id: string;
  client_email: string;
  active: boolean;
  started_at: string;
};

type SharedUpdate = {
  client_id: string;
  kind: "progress" | "journal" | "exercise";
  updated_at: string;
};

export function CoachDashboard() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [recentShares, setRecentShares] = useState<SharedUpdate[]>([]);

  useEffect(() => {
    (async () => {
      const { data: relationships } = await supabase
        .from("coaching_relationships")
        .select("id, client_email, active, started_at")
        .order("started_at", { ascending: false });
      setClients(relationships ?? []);

      // Only rows that pass RLS come back here — i.e. only ones the client
      // has actually opted to share. Nothing to filter client-side.
      const { data: sharedProgress } = await supabase
        .from("progress")
        .select("client_id, updated_at")
        .eq("visible_to_coach", true)
        .order("updated_at", { ascending: false })
        .limit(20);

      const { data: sharedJournal } = await supabase
        .from("journal_entries")
        .select("client_id, created_at")
        .eq("shared_with_coach", true)
        .order("created_at", { ascending: false })
        .limit(20);

      const merged: SharedUpdate[] = [
        ...(sharedProgress ?? []).map((p) => ({
          client_id: p.client_id,
          kind: "progress" as const,
          updated_at: p.updated_at,
        })),
        ...(sharedJournal ?? []).map((j) => ({
          client_id: j.client_id,
          kind: "journal" as const,
          updated_at: j.created_at,
        })),
      ].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

      setRecentShares(merged);
    })();
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto" }}>
      <h1>Clients</h1>

      {/* TODO: "Add a relationship" / "Grant a product" actions — these
          write via a trusted server action (not the client-side anon key,
          since they need to bypass RLS the way the webhook receiver does).
          Simplest path: a small authenticated edge function the dashboard
          calls, mirroring the entitlement-creation logic already in
          paperbell-webhook/index.ts. */}

      <table style={{ width: "100%", marginTop: "1rem" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Client</th>
            <th style={{ textAlign: "left" }}>Status</th>
            <th style={{ textAlign: "left" }}>Started</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id}>
              <td>{c.client_email}</td>
              <td>{c.active ? "Active" : "Inactive"}</td>
              <td>{new Date(c.started_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: "2rem" }}>Recently shared</h2>
      <p style={{ fontSize: "0.875rem", color: "#5c4433" }}>
        Only what clients have chosen to share appears here — nothing is
        visible by default.
      </p>
      <div style={{ display: "grid", gap: "0.5rem", marginTop: "1rem" }}>
        {recentShares.map((s, i) => (
          <div className="card" key={i}>
            {s.kind === "progress" ? "Progress update" : "Journal entry shared"}{" "}
            — {new Date(s.updated_at).toLocaleString()}
          </div>
        ))}
        {recentShares.length === 0 && <p>Nothing shared yet.</p>}
      </div>

      {/* TODO: friendlier purchases/entitlements audit view than the raw
          Supabase table editor, for quick customer-service lookups. */}
    </div>
  );
}
