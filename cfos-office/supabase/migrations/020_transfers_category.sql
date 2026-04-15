-- Transfers category for internal money movement (not spending).
-- Covers Monzo pot moves, Revolut FX, P2P payments, withdrawals/deposits.

INSERT INTO categories (
  id, name, tier, icon, color, description, examples,
  default_value_category, is_holiday_eligible, sort_order
)
VALUES (
  'transfers',
  'Transfers & Internal',
  'financial',
  'arrow-left-right',
  'muted',
  'Internal transfers, currency exchanges, P2P payments, pot moves',
  ARRAY['Bank transfer', 'Currency exchange', 'Pot transfer', 'P2P payment', 'Withdrawal', 'Deposit'],
  null,
  false,
  155
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  examples = EXCLUDED.examples;
