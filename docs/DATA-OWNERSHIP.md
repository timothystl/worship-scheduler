# Data Ownership

## Connect-owned facts

Connect is authoritative for people, households, membership, contact preferences, individual
gifts, batches, deposits, funds, donor statements, volunteer records, schedules, and Serve intake.
Giving remains part of Connect. Consumers receive approved summaries rather than unrestricted
access or a second write path.

## Finance-owned facts

Finance owns accounting imports, chart-of-accounts mapping, budgets, actuals, balances, forecasts,
planning, property finance, compensation scenarios, and future payroll processing. The current
production Finance module still shares `tlc-volunteer-db` and reads Connect-owned fund and Giving
summary data directly; that is current coupling, not the target contract.

The Finance staging schema is intentionally independent and contains only Finance-owned tables.
Its fixtures are deterministic synthetic records marked `SYNTHETIC-NO-PRODUCTION-DATA`. They are
never migrations and must never be mistaken for copied production data.

## External ownership

- Church Website owns public content, newsletters, public forms, and the current payroll surface.
- myMDO owns childcare families, children, schedules, attendance, billing, payments, clocks, and
  approved payroll inputs.
- QuickBooks Budget API is not an active integration. CSV/Excel budget import is authoritative
  unless a separate product decision reopens that integration.

## Contract rule

Cross-product interfaces must define schema/version, authorization, idempotency, failure behavior,
reconciliation, deprecation, and rollback. No consumer may turn a projection into an authoritative
writer accidentally.

The first proposed production-shaped interface is
`contracts/giving-summary-v1.schema.json`. Connect remains its producer and authoritative Giving
owner; Finance is the consumer. It exposes fund/period aggregates, counts, integer-cent totals, and
reconciliation state while excluding donor, person, household identifier, address, and contact
fields. The schema and synthetic example do not create a runtime endpoint or authorize production
reads.

`contracts/message-delivery-v1.schema.json` defines a proposed Connect-to-delivery-adapter request
for email, SMS, and Web Push. It carries bounded channel-specific contact/content fields,
idempotency, correlation, and an explicit transactional-or-consented authorization check. It does
not contain provider credentials or authorize a runtime provider call, queue, scheduled delivery,
or production traffic. Connect remains responsible for the message purpose, recipient eligibility,
and audit record; an adapter may report delivery outcome but does not become the source of truth for
people, consent, or message history.
The paired `message-delivery-result-v1.schema.json` limits adapter outcomes to accepted, delivered,
temporary failure, or permanent failure with explicit retry, dead-letter, or no-retry disposition.
It forbids unbounded raw provider responses.
