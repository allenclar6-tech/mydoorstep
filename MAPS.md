# DOORSTEP Maps and Location

## Initial operating area

DOORSTEP currently operates only in Sapele City, Delta State, Nigeria. Country, state, city, delivery-zone, latitude, and longitude fields are modeled for future expansion without activating other cities.

## Planned provider adapter

Use Google Maps or Mapbox behind a server-side adapter for geocoding, distance, ETA, and route links. Public map tokens may be exposed only where the provider supports that model; secret server credentials must remain server-side.

## Privacy rules

- Capture rider locations only during active assigned deliveries.
- Expose the latest location only to the owning customer, assigned rider, restaurant owner for that order, or authorized admin.
- Define retention and deletion windows before launch.
- Do not expose customer addresses through public discovery or SEO pages.

Distance-based fees and ETA calculation remain pending provider configuration and a reviewed service-area policy.
