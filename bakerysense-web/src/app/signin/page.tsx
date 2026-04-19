"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SigninPage() {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [tenantSlug, setTenantSlug] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setPending(true);
		setError(null);
		try {
			const res = await fetch("/api/auth/signin", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email, password, tenantSlug }),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error ?? `HTTP ${res.status}`);
			}
			// Read ?next= lazily so we don't need useSearchParams (which forces
			// a Suspense boundary in Next 15+ static rendering).
			const next = typeof window !== "undefined"
				? new URLSearchParams(window.location.search).get("next")
				: null;
			router.push(next ?? `/t/${tenantSlug}/dashboard`);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setPending(false);
		}
	}

	return (
		<main className="mx-auto max-w-sm p-8">
			<h1 className="mb-6 text-2xl font-semibold">Sign in to BakerySense</h1>
			<form onSubmit={onSubmit} className="space-y-4">
				<label className="block text-sm">
					Tenant slug
					<input data-testid="signin-slug" value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} required pattern="[a-z0-9-]{1,40}" className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				<label className="block text-sm">
					Email
					<input data-testid="signin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				<label className="block text-sm">
					Password
					<input data-testid="signin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				{error && <p data-testid="signin-error" className="text-sm text-red-600">{error}</p>}
				<button data-testid="signin-submit" disabled={pending} className="w-full rounded bg-amber-600 px-4 py-2 text-white disabled:opacity-50">
					{pending ? "Signing in…" : "Sign in"}
				</button>
			</form>
			<p className="mt-6 text-sm text-stone-600">
				No account? <a className="underline" href="/signup">Create a tenant</a>
			</p>
		</main>
	);
}
