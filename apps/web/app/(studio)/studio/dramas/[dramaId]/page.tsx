import { DramaAdminPage } from "@/components/ported/studio-pages";

export default async function Page({ params }: { readonly params: Promise<{ dramaId: string }> }) {
  const { dramaId } = await params;
  return <DramaAdminPage dramaId={dramaId} />;
}
