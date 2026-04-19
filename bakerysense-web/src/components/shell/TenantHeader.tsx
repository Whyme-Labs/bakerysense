export function TenantHeader({ slug }: { slug: string }) {
  return (
    <div className="mb-6 text-xs uppercase tracking-wider text-[var(--ink-subtle)]">
      Tenant · {slug}
    </div>
  );
}
