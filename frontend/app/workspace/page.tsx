import { WorkspaceApp } from "@/components/WorkspaceApp";

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{
    template?: string;
    document?: string;
    contract?: string;
    mode?: string;
    prompt?: string;
    autostart?: string;
  }>;
}) {
  const params = await searchParams;
  return (
    <WorkspaceApp
      templateId={params.template}
      documentId={params.document}
      contractId={params.contract}
      mode={
        params.mode ||
        (params.document || params.contract ? "assess" : params.template ? "draft" : "create")
      }
      initialPrompt={params.prompt}
      autoStartAssess={params.autostart === "assess"}
    />
  );
}
