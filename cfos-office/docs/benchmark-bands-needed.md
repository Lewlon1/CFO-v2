# Bill benchmark bands — sourcing deliverable

This file enumerates every `(country, bill_subtype)` row currently seeded in
`benchmark_reference` with `band_low / band_high = NULL`. Until each row's
bands are populated with cited sources, the flagger stays silent for that
pair — `flagAgainstBenchmark` treats NULL bands as "not available" and
returns `null`.

**Rule of the layer:** a benchmark with no confirmed source must not be
shown to a user. Don't guess. If a public source can't be cited, leave the
row unpopulated; the silence is the safe default.

## How to fill a row

For each row below, run a small research pass against the suggested source
and produce:

| column     | what to fill                                                                  |
| ---------- | ----------------------------------------------------------------------------- |
| band_low   | monthly equivalent, currency-native (rounded to whole units is fine)          |
| band_high  | monthly equivalent, currency-native (must be >= band_low)                     |
| currency   | already populated (`GBP` for GB, `EUR` for ES)                                |
| basis      | replace the placeholder with the exact basis, e.g. `"median + IQR, Ofcom 2025"` |
| source     | replace `"TODO: <regulator>"` with the citation (regulator + publication + year) |
| source_url | the URL of the publication or dataset                                         |
| updated_at | refresh on each row update                                                    |

Apply via a hand-written staging migration (next available number) plus the
companion `prod-backfill-*.sql`. Don't apply directly via execute_sql; the
audit trail matters.

## Rows to source

### United Kingdom (GB)

| bill_subtype             | suggested source                                                     | notes                                                              |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `broadband`              | Ofcom Pricing Trends (latest annual)                                  | Use the single-household / standard-package band.                  |
| `mobile`                 | Ofcom Pricing Trends (latest annual)                                  | Single SIM-only plan; exclude bundles.                             |
| `electricity`            | Ofgem default tariff cap + ONS LCFS                                   | Median household, dual-fuel split into electricity-only equivalent. |
| `gas`                    | Ofgem default tariff cap + ONS LCFS                                   | Median household, dual-fuel split into gas-only equivalent.        |
| `home_insurance`         | ABI Home Insurance Premium Tracker                                    | Contents + buildings combined; latest quarter.                     |
| `auto_insurance`         | ABI Motor Insurance Premium Tracker                                   | Comprehensive; latest quarter.                                     |
| `streaming_subscription` | Published retail price list (Netflix / Spotify / Disney+ standard tiers) | Band = lowest standard-tier price to highest standard-tier price across the three. Not a market average — a publishable retail range. |

### Spain (ES)

| bill_subtype             | suggested source                                                                | notes                                                       |
| ------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `broadband`              | CNMC sector report (telecoms)                                                    | Single-household / standard-package band.                   |
| `mobile`                 | CNMC sector report (telecoms)                                                    | Single SIM-only plan.                                       |
| `electricity`            | CNMC + IDAE household energy report                                              | Single household, regulated PVPC tariff equivalent.         |
| `gas`                    | CNMC + IDAE household energy report                                              | Single household, regulated TUR tariff equivalent.          |
| `home_insurance`         | UNESPA / ICEA insurance sector report                                            | Multi-risk hogar standard.                                  |
| `auto_insurance`         | UNESPA / ICEA insurance sector report                                            | Standard motor.                                             |
| `streaming_subscription` | Published retail price list (Netflix / Spotify / Disney+ Movistar Plus standard) | Band = lowest standard-tier price to highest. Retail range. |

## Categories deliberately excluded

The `bill_subtype` enum is the allowlist. Lifestyle-variable categories
(groceries, dining, transport-as-spend) are not benchmarked at the type-system
level — a national average there is meaningless against one person's life and
makes the CFO sound stupid. Adding them is a future migration, not a runtime
config.

## Out-of-policy surface (flag for a separate audit)

`src/lib/bills/provider-registry.ts` and `src/lib/ai/tools/search-bill-alternatives.ts`
predate the observation-only boundary that this layer enforces. They name
specific providers (Iberdrola, Octopus, EE, Movistar, etc.) and recommend
alternatives. That contradicts `ADVISORY_BOUNDARIES` and the Constitution §4
(no named third-party services). They were left untouched in this session
per the plan; Lewis to decide whether to retire / observationalise them in a
follow-on session.
