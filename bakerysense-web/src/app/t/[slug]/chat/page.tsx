import { ChatThread } from "@/components/chat/ChatThread";
import { TenantHeader } from "@/components/shell/TenantHeader";

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ branch?: string; prefill?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const branch = sp.branch ?? "";

  if (!branch) {
    return (
      <>
        <TenantHeader slug={slug} />
        <p>Select a branch to start a conversation.</p>
      </>
    );
  }

  return (
    <>
      <TenantHeader slug={slug} />
      <h1 className="mb-4 text-2xl font-semibold">Chat</h1>
      <ChatThread branchId={branch} prefill={sp.prefill} />
    </>
  );
}
