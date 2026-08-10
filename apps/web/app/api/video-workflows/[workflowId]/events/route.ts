import { proxyVideoWorkflow } from "@/lib/video-workflow-proxy";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function GET(request: Request, context: { params: Promise<{ workflowId: string }> }): Promise<Response> {
  const { workflowId } = await context.params;
  return proxyVideoWorkflow(request, `/video-workflows/${encodeURIComponent(workflowId)}/events`);
}
