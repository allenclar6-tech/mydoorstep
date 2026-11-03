import { COVERAGE_LABEL, COVERED_STATES } from '../../server/coverage.js'

/**
 * Town picker for partner and rider sign-up: every town DOORSTEP serves, grouped by state. Submits `cityName`
 * (the town), which the server matches to its service area.
 */
export function CityField({ name = 'cityName', defaultValue = '', label = 'Town or city' }) {
  return <label>{label}<select required name={name} defaultValue={defaultValue}>
    <option value="" disabled>Choose your town</option>
    {COVERED_STATES.map((state) => <optgroup key={state.name} label={state.name}>{state.cities.map((city) => <option key={city} value={city}>{city}</option>)}</optgroup>)}
  </select><small className="setup-tip">DOORSTEP operates in {COVERAGE_LABEL}.</small></label>
}
