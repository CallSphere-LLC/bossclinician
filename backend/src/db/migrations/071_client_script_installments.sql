-- Owner-approved alternative: two $24 installments for Client Consultation
-- Call Script: $24 now and $24 after seven days, $48 total.
INSERT INTO offer_pricing_options (offer_id,label,pricing_type,amount_cents,currency,interval,interval_count,installment_count,sort)
SELECT o.id,'$24 now + $24 after 7 days ($48 total)','payment_plan',2400,'usd','week',1,2,1
FROM offers o WHERE o.slug='client-consultation-call-script'
 AND NOT EXISTS(SELECT 1 FROM offer_pricing_options p WHERE p.offer_id=o.id AND p.pricing_type='payment_plan' AND p.amount_cents=2400 AND p.installment_count=2);
UPDATE offers SET checkout_headline='Pay $37 in full, or $24 today and $24 after 7 days ($48 total).',updated_at=now()
WHERE slug='client-consultation-call-script';
UPDATE courses SET price_text='$37 or $24 now + $24 after 7 days ($48 total)',updated_at=now()
WHERE slug='client-consultation-call-script';
