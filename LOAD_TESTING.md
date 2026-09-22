# DOORSTEP Load Testing Plan

No concurrent-user capacity is claimed until measured.

## Scenarios

- Public homepage and restaurant discovery
- Restaurant menu browsing
- Login and verification requests
- Checkout quote and order creation
- Payment initialization
- Order tracking
- Restaurant order queue
- Rider delivery queue
- Admin approval and support queues

## Measurements

Record p50/p95/p99 latency, error rate, throughput, database connection usage, CPU, memory, and external-provider latency. Test authenticated and unauthenticated traffic separately.

## Safe process

Use a staging database and test payment credentials. Seed representative but non-production data. Start with a small load, increase gradually, and stop if database or provider limits are approached. Add pagination and caching only after profiling the actual query path.
