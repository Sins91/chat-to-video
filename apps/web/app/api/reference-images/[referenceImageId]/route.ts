import { proxyVideoWorkflow } from "@/lib/video-workflow-proxy";

export const dynamic = "force-dynamic";
export const GET = (request: Request, context: { params: Promise<{ referenceImageId: string }> }): Promise<Response> =>
  context.params.then(({ referenceImageId }) => proxyVideoWorkflow(request, `/reference-images/${encodeURIComponent(referenceImageId)}`));
export const DELETE = (request: Request, context: { params: Promise<{ referenceImageId: string }> }): Promise<Response> =>
  context.params.then(({ referenceImageId }) => proxyVideoWorkflow(request, `/reference-images/${encodeURIComponent(referenceImageId)}`));
