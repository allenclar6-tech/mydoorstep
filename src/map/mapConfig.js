// Map settings shared by lightweight helpers. Kept free of mapbox-gl so that importing a
// formatter or the token does not pull the map library into the main bundle.

// Public, browser-side token. It is not a secret: restrict it to the DOORSTEP
// website URLs and the public scopes the app needs in the Mapbox account.
export const mapToken = import.meta.env.VITE_MAP_PUBLIC_TOKEN || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || ''
export const SAPELE_CENTER = [5.6846, 5.8916]
