# DOORSTEP Disaster Recovery

This document is a preparation runbook; backups and restoration have not been verified yet.

## Protect

- Managed PostgreSQL point-in-time backups
- Private object-storage versioning and lifecycle policies
- Environment secret backups in an approved secret manager
- Deployment artifacts and migration history

## Recovery steps

1. Declare the incident and freeze risky administrative actions.
2. Check API health, readiness, database, provider, and storage status.
3. Restore PostgreSQL to a verified recovery point in an isolated environment.
4. Restore private object storage or switch to the latest versioned bucket.
5. Run migration status and smoke tests.
6. Reconcile payments and orders created around the incident.
7. Redirect traffic only after owner approval and record the incident.

Define RPO/RTO targets and perform a restore drill before launch.
