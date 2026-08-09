import { createHook, RetryableError, sleep } from 'workflow';
import { start } from 'workflow/api';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
    Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

type WorkflowRequest = {
  requestId: string;
};

type WorkflowResult = {
  requestId: string;
  completedAt: string;
};

async function completeRequestStep(
  request: WorkflowRequest,
): Promise<WorkflowResult> {
  'use step';

  return {
    requestId: request.requestId,
    completedAt: new Date().toISOString(),
  };
}

async function validationWorkflow(
  request: WorkflowRequest,
): Promise<WorkflowResult> {
  'use workflow';

  await sleep('1s');
  return completeRequestStep(request);
}

async function approvalWorkflow(requestId: string): Promise<boolean> {
  'use workflow';

  const approval = createHook<{ isApproved: boolean }>({
    token: `approval:${requestId}`,
  });
  const result = await approval;

  if (!result.isApproved) {
    throw new RetryableError('Approval is pending.', { retryAfter: '1m' });
  }

  return result.isApproved;
}

async function startWorkflowContract(request: WorkflowRequest) {
  const run = await start(validationWorkflow, [request]);
  const result: WorkflowResult = await run.returnValue;

  return { runId: run.runId, result };
}

type _WorkflowStartContract = Expect<
  Equal<
    Awaited<ReturnType<typeof startWorkflowContract>>,
    { runId: string; result: WorkflowResult }
  >
>;

void approvalWorkflow;
