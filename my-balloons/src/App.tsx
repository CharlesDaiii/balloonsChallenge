import React, { useEffect, useMemo, useState } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap, useMapEvents } from "react-leaflet";
import { Loader2, Wind } from "lucide-react";

/**
 * Pure Frontend Demo (TSX Version):
 * - Fetch WindBorne 00..23.json (one snapshot per hour), parse as [lat, lon, alt(km?)]
 * - Map displays all balloon positions for the selected hour
 * - Click balloon point to request Open‑Meteo, display ground-level wind speed/direction (as wind field proxy)
 */

const HOURS: string[] = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"));
// const WB_BASE = "https://a.windbornesystems.com/treasure/"; // 00.json .. 23.json
const WB_BASE = "/api/wb/treasure/";

export type Point = { lat: number; lon: number; alt_km: number | null };
export type Wx = {
  tempC?: number; windspeed10m?: number; winddir10m?: number;
  windspeed100m?: number; winddir100m?: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function parseRow(row: unknown): Point | null {
  if (!Array.isArray(row) || row.length < 2) return null;
  const [lat, lon, alt] = row as [unknown, unknown, unknown];
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const alt_km = typeof alt === "number" && alt >= 0 && alt <= 40 ? alt : null; // Error tolerance
  return { lat, lon, alt_km };
}

async function fetchHour(hh: string): Promise<Point[]> {
  const url = `${WB_BASE}${hh}.json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`WB ${hh}.json HTTP ${res.status}`);
  const data = await res.json();
  const rows: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as any)?.points)
    ? (data as any).points
    : [];
  return rows.map(parseRow).filter(Boolean) as Point[];
}

function useWindborne(): { loading: boolean; error: string; byHour: Point[][] } {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [byHour, setByHour] = useState<Point[][]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const all = await Promise.all(
          HOURS.map(async (hh) => {
            try {
              return await fetchHour(hh);
            } catch (e) {
              console.warn("skip hour", hh, e);
              return [] as Point[];
            }
          })
        );
        if (!cancelled) setByHour(all);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, error, byHour };
}

async function fetchOpenMeteo(lat: number, lon: number): Promise<Wx> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lon.toString());
  url.searchParams.set("current_weather", "true");
  url.searchParams.set("hourly", "windspeed_100m,winddirection_100m");
  url.searchParams.set("timezone", "auto");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Open‑Meteo HTTP ${res.status}`);
  const j = await res.json();
  const cw = (j as any).current_weather || {};
  const hourly = (j as any).hourly || {};
  return {
    tempC: cw.temperature,
    windspeed10m: cw.windspeed,
    winddir10m: cw.winddirection,
    windspeed100m: Array.isArray(hourly.windspeed_100m) ? hourly.windspeed_100m[0] : undefined,
    winddir100m: Array.isArray(hourly.winddirection_100m) ? hourly.winddirection_100m[0] : undefined,
  };
}

function WindArrow({ deg }: { deg?: number }) {
  const rot = deg ?? 0;
  return (
    <div className="flex items-center gap-1">
      <Wind className="h-4 w-4" style={{ transform: `rotate(${rot}deg)` }} />
      <span className="text-xs text-gray-500">{Math.round(rot)}°</span>
    </div>
  );
}

function FitToBounds({ points, autoFit, force = 0 }: { points: Point[]; autoFit: boolean; force?: number }) {
  const map = useMap();
  useEffect(() => {
    if (!points?.length) return;
    // Only auto-fit when enabled, or when a one-time force trigger is fired
    if (!autoFit && force === 0) return;
    const lats = points.map((p) => p.lat);
    const lons = points.map((p) => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    map.fitBounds(
      [
        [clamp(minLat, -89.9, 89.9), clamp(minLon, -179.9, 179.9)],
        [clamp(maxLat, -89.9, 89.9), clamp(maxLon, -179.9, 179.9)],
      ],
      { padding: [30, 30] }
    );
  }, [points, map, autoFit, force]);
  return null;
}

function UserInteractionWatcher({ onInteract }: { onInteract: () => void }) {
  useMapEvents({
    movestart: onInteract,
    zoomstart: onInteract,
  });
  return null;
}

export default function App() {
  const { loading, error, byHour } = useWindborne();
  const [hourIdx, setHourIdx] = useState<number>(0); // 0 = current (00.json)
  const points: Point[] = byHour[hourIdx] || [];

  const [selected, setSelected] = useState<Point | null>(null); // {lat, lon, alt_km}
  const [wx, setWx] = useState<Wx | null>(null); // Open‑Meteo response
  const [wxLoading, setWxLoading] = useState<boolean>(false);
  const [wxErr, setWxErr] = useState<string>("");

  const [autoFit, setAutoFit] = useState<boolean>(true);
  const [fitNonce, setFitNonce] = useState<number>(0);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      try {
        setWxLoading(true);
        setWxErr("");
        const r = await fetchOpenMeteo(selected.lat, selected.lon);
        if (!cancelled) setWx(r);
      } catch (e) {
        if (!cancelled) setWxErr(String(e));
      } finally {
        if (!cancelled) setWxLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const countAll = useMemo(() => byHour.reduce((a, h) => a + ((h?.length) || 0), 0), [byHour]);

  return (
    <div className="w-full min-h-screen flex flex-col bg-white text-gray-900">
      {/* Top Bar */}
      <div className="p-3 border-b flex items-center justify-between gap-3 bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">🎈 Balloons + 🌬 Open‑Meteo</h1>
          <div className="text-sm text-gray-500 hidden md:block">
            Loaded {byHour.filter(Boolean).length}/24 hours · Total {countAll} points
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">Selected hour (0=current)</span>
          <input
            type="range"
            min={0}
            max={23}
            step={1}
            value={hourIdx}
            onChange={(e) => setHourIdx(Number(e.target.value))}
            className="w-48 accent-blue-600"
          />
          <button
            onClick={() => setHourIdx(0)}
            className="px-3 py-1.5 rounded-md border text-sm bg-white text-gray-700 border-gray-300 hover:bg-gray-50 active:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
          >Back to Current</button>
          <label className="flex items-center gap-2 text-sm ml-2">
            <input
              type="checkbox"
              checked={autoFit}
              onChange={(e) => setAutoFit(e.target.checked)}
            />
            Auto-fit
          </label>
          <button
            onClick={() => setFitNonce((n) => n + 1)}
            className="px-3 py-1.5 rounded-md border text-sm bg-white text-gray-700 border-gray-300 hover:bg-gray-50 active:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ml-2"
          >
            Fit to Data
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div className="grid md:grid-cols-[2fr_1fr] grid-cols-1 gap-3 p-3">
        <div className="border rounded-xl overflow-hidden bg-white">
          <div className="h-[70vh] md:h-[calc(100vh-150px)]">
            <MapContainer
              center={[20, 0]}
              zoom={2}
              className="h-full w-full"
              maxBounds={[[-85, -180], [85, 180]]}
              maxBoundsViscosity={1.0}
              maxZoom={19}
              minZoom={2}
            >
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                noWrap={true}
                maxZoom={19}
                maxNativeZoom={19}
                minZoom={2}
                bounds={[[-85, -180], [85, 180]]}
                keepBuffer={0}
              />
              <UserInteractionWatcher onInteract={() => setAutoFit(false)} />
              <FitToBounds points={points} autoFit={autoFit} force={fitNonce} />
              {points.map((p, i) => (
                <CircleMarker
                  key={`${p.lat.toFixed(4)}_${p.lon.toFixed(4)}_${i}`}
                  center={[p.lat, p.lon]}
                  radius={3}
                  eventHandlers={{ click: () => setSelected(p) } as any}
                >
                  <Popup>
                    <div className="text-sm">
                      <div><b>Lat</b> {p.lat.toFixed(4)} · <b>Lon</b> {p.lon.toFixed(4)}</div>
                      <div><b>Alt</b> {p.alt_km != null ? `${p.alt_km.toFixed(2)} km` : "—"}</div>
                      <div className="mt-2 text-xs text-gray-500">Click to load wind information for this point</div>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </div>

        <div className="border rounded-xl p-4 bg-white">
          <div className="font-medium mb-2">Point Information / Wind Field</div>
          {!selected && <div className="text-sm text-gray-500">Click any balloon point on the map to view wind speed/direction</div>}
          {selected && (
            <div className="text-sm">
              <div className="mb-2">Selected: <b>{selected.lat.toFixed(4)}</b>, <b>{selected.lon.toFixed(4)}</b> (Altitude {selected.alt_km != null ? `${selected.alt_km.toFixed(2)} km` : "—"})</div>
              {wxLoading && (
                <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-4 w-4 animate-spin"/> Fetching Open‑Meteo...</div>
              )}
              {wxErr && (
                <div className="text-red-600">{wxErr}</div>
              )}
              {wx && !wxLoading && !wxErr && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span>Ground-level Wind Speed (10m)</span>
                    <b>{Math.round(wx.windspeed10m ?? 0)} m/s</b>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Ground-level Wind Direction (10m)</span>
                    <WindArrow deg={wx.winddir10m} />
                  </div>
                  {wx.windspeed100m != null && (
                    <div className="flex items-center justify-between">
                      <span>100m Wind Speed</span>
                      <b>{Math.round(wx.windspeed100m)} m/s</b>
                    </div>
                  )}
                  {wx.winddir100m != null && (
                    <div className="flex items-center justify-between">
                      <span>100m Wind Direction</span>
                      <WindArrow deg={wx.winddir100m} />
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span>Temperature</span>
                    <b>{wx.tempC != null ? `${wx.tempC} °C` : "—"}</b>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="p-3 border-t text-xs text-gray-500 flex items-center justify-between bg-white">
        {loading ? (
          <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin"/> Loading balloon data...</div>
        ) : error ? (
          <div className="text-red-600 truncate">{error}</div>
        ) : (
          <div>✅ Data loading complete · Drag the slider above to switch hours</div>
        )}
        <div>
          Data source: WindBorne 24-hour snapshots (00..23.json) · Wind field: Open‑Meteo current_weather
        </div>
      </div>
    </div>
  );
}
