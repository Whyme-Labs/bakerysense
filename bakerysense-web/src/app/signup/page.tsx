"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
	const router = useRouter();
	const [form, setForm] = useState({ email: "", password: "", tenantName: "", tenantSlug: "", vertical: "bakery" as const });
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) { setForm({ ...form, [k]: v }); }

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setPending(true); setError(null);
		try {
			const res = await fetch("/api/auth/signup", {
				method: "POST", headers: { "content-type": "application/json" },
				body: JSON.stringify(form),
			});
			if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(b.error ?? `HTTP ${res.status}`); }
			router.push(`/t/${form.tenantSlug}/dashboard`);
		} catch (e) { setError((e as Error).message); } finally { setPending(false); }
	}

	return (
		<main className="mx-auto max-w-sm p-8">
			<h1 className="mb-6 text-2xl font-semibold">Create a tenant</h1>
			<form onSubmit={onSubmit} className="space-y-4">
				<label className="block text-sm">Tenant name
					<input data-testid="signup-tenant-name" value={form.tenantName} onChange={(e) => set("tenantName", e.target.value)} required minLength={1} className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				<label className="block text-sm">Tenant slug
					<input data-testid="signup-tenant-slug" value={form.tenantSlug} onChange={(e) => set("tenantSlug", e.target.value)} required pattern="[a-z0-9-]{1,40}" className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				<label className="block text-sm">Vertical
					<select data-testid="signup-vertical" value={form.vertical} onChange={(e) => set("vertical", e.target.value as typeof form.vertical)} className="mt-1 block w-full rounded border px-3 py-2">
						<option value="bakery">Bakery</option>
						<option value="grocery">Grocery</option>
						<option value="pharmacy">Pharmacy</option>
						<option value="retail">Retail</option>
						<option value="other">Other</option>
					</select>
				</label>
				<label className="block text-sm">Email
					<input data-testid="signup-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				<label className="block text-sm">Password
					<input data-testid="signup-password" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required minLength={12} className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				{error && <p data-testid="signup-error" className="text-sm text-red-600">{error}</p>}
				<button data-testid="signup-submit" disabled={pending} className="w-full rounded bg-amber-600 px-4 py-2 text-white disabled:opacity-50">
					{pending ? "Creating…" : "Create tenant"}
				</button>
			</form>
			<p className="mt-6 text-sm text-stone-600">Already a member? <a className="underline" href="/signin">Sign in</a></p>
		</main>
	);
}
