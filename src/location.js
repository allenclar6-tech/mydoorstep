export function readConfirmedLocation() {
  const stored = localStorage.getItem('doorstep-location-coordinates')
  if (!stored) return null

  try {
    const location = JSON.parse(stored)
    if (
      !Number.isFinite(location.latitude)
      || location.latitude < -90
      || location.latitude > 90
      || !Number.isFinite(location.longitude)
      || location.longitude < -180
      || location.longitude > 180
    ) return null
    return location
  } catch {
    return null
  }
}
