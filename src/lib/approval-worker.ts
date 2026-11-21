import { buildApprovalPlan, type ApprovalRequest } from '../../shared/approvals';

self.addEventListener('message', (event: MessageEvent<ApprovalRequest>) => {
  self.postMessage(buildApprovalPlan(event.data));
});
