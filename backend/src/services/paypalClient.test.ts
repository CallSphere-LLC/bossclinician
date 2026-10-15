import { describe, expect, it } from 'vitest';
import { centsToUsd, completedCapture, paypalSandboxReady } from './paypalClient';

describe('PayPal sandbox checkout guards', () => {
  it('requires explicit sandbox configuration', () => {
    expect(paypalSandboxReady()).toBe(false);
  });
  it('checks whole-cent USD amounts and completed captures', () => {
    expect(centsToUsd(9700)).toBe('97.00');
    expect(() => centsToUsd(0)).toThrow();
    const order = { id:'PAYPAL-1',status:'COMPLETED',purchase_units:[{custom_id:'42',payments:{captures:[{id:'CAPTURE-1',status:'COMPLETED',amount:{currency_code:'USD',value:'97.00'}}]}}] };
    expect(completedCapture(order,{orderId:42,amountCents:9700})?.id).toBe('CAPTURE-1');
    expect(completedCapture(order,{orderId:42,amountCents:9701})).toBeNull();
    expect(completedCapture(order,{orderId:43,amountCents:9700})).toBeNull();
  });
});
