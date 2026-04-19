import { Nav } from "@/components/shell/Nav";

export default async function TenantLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  await params;   // force param resolution
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </>
  );
}
