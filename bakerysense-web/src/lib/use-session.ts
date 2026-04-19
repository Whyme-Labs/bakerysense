"use client";
import { useEffect, useState } from "react";
import { apiJson } from "./api-client";

export interface SessionClaims {
  sub: string;
  tid: string;
  role: "platform_admin" | "tenant_admin" | "branch_manager" | "staff" | "viewer";
  branches: string[] | null;
  kid: string;
}

export function useSession(): { claims: SessionClaims | null; loading: boolean; error: string | null } {
  const [claims, setClaims] = useState<SessionClaims | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiJson<{ claims: SessionClaims }>("/api/auth/me")
      .then((b) => { if (!cancelled) setClaims(b.claims); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return { claims, loading, error };
}
