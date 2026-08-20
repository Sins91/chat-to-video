import { proxyVideoWorkflow } from "@/lib/video-workflow-proxy";

export const dynamic = "force-dynamic";
export const POST = (request: Request): Promise<Response> => proxyVideoWorkflow(request, "/reference-images/uploads");
