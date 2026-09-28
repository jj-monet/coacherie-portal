import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type ViewState = "loading" | "ready" | "blocked";

export function ToolViewer() {
  const { slug } = useParams<{ slug: string }>();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [title, setTitle] = useState("");
  const [html, setHtml] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setView("loading");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !slug) {
        if (!cancelled) setView("blocked");
        return;
      }

      const { data: product, error: productErr } = await supabase
        .from("products")
        .select("title, tool_path")
        .eq("slug", slug)
        .maybeSingle();
      if (productErr || !product || !product.tool_path) {
        if (!cancelled) setView("blocked");
        return;
      }
      if (!cancelled) setTitle(product.title);

      // The file lives in a private bucket. The database only hands it over
      // if this user has an active entitlement to the product it belongs to.
      const { data: blob, error: downloadErr } = await supabase.storage.from("tools").download(product.tool_path);
      if (downloadErr || !blob) {
        console.warn("Tool download failed:", downloadErr);
        if (!cancelled) setView("blocked");
        return;
      }

      const raw = await blob.text();
      // Tell the tool who is signed in so it can keep each person's saved work separate.
      const inject = `<script>window.COACHERIE_NS=${JSON.stringify(user.id)};</script>`;
      const withNs = raw.includes("<head>") ? raw.replace("<head>", () => "<head>" + inject) : inject + raw;
      if (!cancelled) {
        setHtml(withNs);
        setView("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // The tools can't send email themselves. They ask this page (which holds the
  // login), and it calls the send-results function on their behalf.
  useEffect(() => {
    if (view !== "ready") return;
    const onMessage = async (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data || {};
      if (d.type !== "coacherie:send-results") return;

      let ok = false;
      let errorMessage = "";
      try {
        const { error } = await supabase.functions.invoke("send-results", {
          body: { slug, subject: d.subject, body: d.body },
        });
        ok = !error;
        if (error) errorMessage = error.message;
      } catch (err: any) {
        errorMessage = String(err?.message ?? err);
      }
      (e.source as Window).postMessage({ type: "coacherie:send-results:done", id: d.id, ok, error: errorMessage }, "*");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [view, slug]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: "var(--color-surface-cream)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          fontSize: "0.9rem",
          borderBottom: "1px solid rgba(45,42,38,0.10)",
          flexShrink: 0,
        }}
      >
        <Link to="/portal" style={{ color: "var(--color-walnut)" }}>
          ← Back to your courses
        </Link>
        <span style={{ color: "var(--color-walnut)" }}>{title}</span>
      </div>

      {view === "loading" && <p style={{ textAlign: "center", marginTop: "3rem" }}>Loading…</p>}

      {view === "blocked" && (
        <div style={{ maxWidth: 480, margin: "3rem auto", padding: "0 1rem", textAlign: "center" }}>
          <p>We couldn't open this. If you just purchased it, it can take up to 20 minutes to show up — try again shortly.</p>
          <Link to="/portal">Back to your courses</Link>
        </div>
      )}

      {view === "ready" && html && (
        <iframe
          ref={iframeRef}
          title={title}
          srcDoc={html}
          allow="clipboard-write"
          style={{ flex: 1, width: "100%", border: 0, minHeight: 0 }}
        />
      )}
    </div>
  );
}
