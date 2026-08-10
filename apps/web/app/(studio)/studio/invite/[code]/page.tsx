import { InvitePage } from "@/components/ported/studio-pages";

export default async function Page({ params }: { readonly params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <InvitePage code={code} />;
}
