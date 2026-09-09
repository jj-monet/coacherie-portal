import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { Login } from "./pages/Login";
import { Portal } from "./pages/Portal";
import { CoachDashboard } from "./pages/CoachDashboard";

export default function App() {
  const [session, setSession] = useState<any>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <p style={{ textAlign: "center", marginTop: "4rem" }}>Loading…</p>;
  }

  return (
    <Routes>
      <Route path="/" element={session ? <Navigate to="/portal" /> : <Login />} />
      <Route path="/portal" element={session ? <Portal /> : <Navigate to="/" />} />
      <Route path="/coach" element={session ? <CoachDashboard /> : <Navigate to="/" />} />
    </Routes>
  );
}
