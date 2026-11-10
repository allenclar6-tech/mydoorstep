# Road routing (real road distances)

DOORSTEP charges delivery by the road distance between the store pin and the customer pin. The API asks a
routing provider for that distance. If none is set up, or all of them fail, exact pins are still priced from
the straight line × the detour allowance in Admin › Delivery prices (if that switch is on), and anything less
certain goes to Admin › Prices to confirm. It never guesses a price for an address with no pin.

## Settings (API application in Coolify → Environment Variables)

| Variable | What it does | Example |
|---|---|---|
| `ROUTING_PROVIDERS` | Providers to try, in order, comma-separated. Default `mapbox,osrm`. | `osrm,mapbox` |
| `OSRM_URL` | Address of your own OSRM server (no trailing slash). Free. | `http://osrm:5000` |
| `MAPBOX_SERVER_TOKEN` | Server-only Mapbox token for the Directions API. Never put it in a `VITE_` variable. | (secret) |

Only providers that have their setting are used. Admin › Delivery prices shows which ones are active and
whether the last request to each worked.

## Cost

- **OSRM on your ZimaOS server: free.** It uses OpenStreetMap data and runs on your own hardware.
- **Mapbox Directions: paid beyond a free monthly allowance.** Check the current allowance and price at
  mapbox.com/pricing before relying on it. DOORSTEP caches each store→address distance, which keeps the
  number of requests down. Recommended: `ROUTING_PROVIDERS=osrm,mapbox` so Mapbox is only the backup.

## Run OSRM on ZimaOS (one-time setup)

You need a terminal on the ZimaOS box and a few GB of free RAM during the build step.

```bash
mkdir -p /DATA/osrm && cd /DATA/osrm
wget https://download.geofabrik.de/africa/nigeria-latest.osm.pbf
docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/car.lua /data/nigeria-latest.osm.pbf
docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend osrm-partition /data/nigeria-latest.osrm
docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/nigeria-latest.osrm
```

Then run the server so the API can reach it. The simplest way in Coolify: add a **Docker Image** resource
`ghcr.io/project-osrm/osrm-backend`, start command `osrm-routed --algorithm mld /data/nigeria-latest.osrm`,
a volume mapping `/DATA/osrm` → `/data`, on the same network as the API, and no public domain (only the API
needs it). Set `OSRM_URL` on the API to that container's internal address, e.g. `http://osrm:5000`.

Check it from the ZimaOS terminal (Sapele → Warri):

```bash
curl "http://localhost:5000/route/v1/driving/5.6767,5.8941;5.7500,5.5167?overview=false"
```

You should see `"code":"Ok"` and a `distance` in metres.

**Refreshing the map:** OpenStreetMap is updated by volunteers. Every few months, download the file again and
re-run the three build commands, then restart the OSRM container. Rider road reports (Admin › Road reports)
cover what the map doesn't know in the meantime.

Note: the `car` profile is used for motorbikes too. Real rider routes can be shorter through small paths;
the distance accuracy settings and rider road reports handle that.
