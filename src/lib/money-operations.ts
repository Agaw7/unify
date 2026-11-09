import { MoneyError } from './money-server';

export async function observeRefund(_reference: string): Promise<never> {
  void _reference;
  throw new MoneyError('Automated refund reconciliation is unavailable. Review the external account records manually.', 503);
}

export async function observeSignedDispute(_resource: Record<string, unknown>, _timestamp: number): Promise<never> {
  void _resource;
  void _timestamp;
  throw new MoneyError('Automated dispute reconciliation is unavailable. Review the external account records manually.', 503);
}

export function providerTime(_value: unknown): number {
  void _value;
  throw new MoneyError('Provider event processing is unavailable.', 503);
}

export async function syncPaymentRisk(_paymentId: string, _deadline?: number): Promise<never> {
  void _paymentId;
  void _deadline;
  throw new MoneyError('Automated payment risk checks are unavailable.', 503);
}

export async function submitRefund(_id: string, _actor: string): Promise<never> {
  void _id;
  void _actor;
  throw new MoneyError('Automated refunds are unavailable. Use an approved manual process.', 503);
}

export async function runReconciliation() {
  return { paused: true, reason: 'Automated provider reconciliation is unavailable.' };
}
