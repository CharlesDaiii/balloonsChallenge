import React, { useEffect, useMemo, useState } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
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

function useWindborne(): { loading: boolean; error: string; byHour: Point[][]; progress: number } {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [byHour, setByHour] = useState<Point[][]>(Array.from({ length: HOURS.length }, () => []));
  const [progress, setProgress] = useState<number>(0); // 0..1

  useEffect(() => {
    let cancelled = false;
    let completed = 0;

    setLoading(true);
    setError("");
    setByHour(Array.from({ length: HOURS.length }, () => []));
    setProgress(0);

    HOURS.forEach((hh, idx) => {
      fetchHour(hh)
        .then((points) => {
          if (cancelled) return;
          setByHour((prev) => {
            const next = prev.slice();
            next[idx] = points;
            return next;
          });
        })
        .catch((e) => {
          console.warn("skip hour", hh, e);
          // Leave this hour as empty array
        })
        .finally(() => {
          if (cancelled) return;
          completed += 1;
          setProgress(completed / HOURS.length);
          if (completed === HOURS.length) {
            setLoading(false);
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, error, byHour, progress };
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

function degToCompassName(deg?: number): string {
  if (deg == null || Number.isNaN(deg)) return "—";
  const names = [
    "N","NNE","NE","ENE","E","ESE","SE","SSE",
    "S","SSW","SW","WSW","W","WNW","NW","NNW"
  ];
  const i = Math.round(((((deg % 360) + 360) % 360) / 22.5)) % 16;
  return names[i];
}

function WindCompass({ d10, s10, d100, s100 }: { d10?: number; s10?: number; d100?: number; s100?: number }) {
  const [mode, setMode] = useState<"10m" | "100m">("10m");
  const dir = mode === "10m" ? d10 : d100;
  const spd = mode === "10m" ? s10 : s100;
  const has100 = typeof d100 === "number" || typeof s100 === "number";
  const displayDeg = dir ?? 0;
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-2">
                 <div className="text-sm text-gray-600">Wind Direction (from)</div>
        <div className="inline-flex rounded-md border overflow-hidden">
          <button
            className={`px-2 py-1 text-xs ${mode === '10m' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
            onClick={() => setMode('10m')}
          >10m</button>
          {has100 && (
            <button
              className={`px-2 py-1 text-xs border-l ${mode === '100m' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
              onClick={() => setMode('100m')}
            >100m</button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <svg viewBox="0 0 200 200" className="w-44 h-44">
          <circle cx="100" cy="100" r="80" fill="white" stroke="#e5e7eb" strokeWidth="2" />
          {ticks.map((t) => (
            <line
              key={t}
              x1="100" y1="20" x2="100" y2="28"
              stroke="#9ca3af"
              strokeWidth={t % 90 === 0 ? 2 : 1}
              transform={`rotate(${t} 100 100)`}
            />
          ))}
          <text x="100" y="16" textAnchor="middle" fontSize="10" fill="#374151">N</text>
          <text x="184" y="104" textAnchor="middle" fontSize="10" fill="#374151">E</text>
          <text x="100" y="196" textAnchor="middle" fontSize="10" fill="#374151">S</text>
          <text x="16" y="104" textAnchor="middle" fontSize="10" fill="#374151">W</text>
          {/* Arrow pointing FROM direction (meteorological) */}
          <g transform={`rotate(${displayDeg} 100 100)`}>
            <line x1="100" y1="100" x2="100" y2="42" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
            <polygon points="100,34 94,48 106,48" fill="#2563eb" />
          </g>
        </svg>
        <div className="text-sm">
          <div className="text-2xl font-semibold">
            {degToCompassName(dir)} <span className="text-gray-500 text-base">({Math.round(dir ?? 0)}°)</span>
          </div>
                     <div className="mt-1 text-gray-600">Wind Speed: <b>{spd != null ? Math.round(spd) : '—'}</b> m/s · Height: <b>{mode}</b></div>
                     {has100 && <div className="mt-2 text-xs text-gray-500">Switch between 10m / 100m to compare wind directions at different heights</div>}
        </div>
      </div>
    </div>
  );
}

const ALT_BANDS: { label: string; color: string; test: (a: number | null) => boolean }[] = [
  { label: "Unknown / Ground", color: "#6b7280", test: (a) => a == null || a < 1 },
  { label: "1–5 km", color: "#22c55e", test: (a) => (a ?? -1) >= 1 && (a as number) < 5 },
  { label: "5–10 km", color: "#3b82f6", test: (a) => (a ?? -1) >= 5 && (a as number) < 10 },
  { label: "10–20 km", color: "#f59e0b", test: (a) => (a ?? -1) >= 10 && (a as number) < 20 },
  { label: "≥20 km", color: "#ef4444", test: (a) => (a ?? -1) >= 20 },
];

function colorForAlt(alt_km: number | null): string {
  for (const b of ALT_BANDS) {
    if (b.test(alt_km)) return b.color;
  }
  return "#6b7280"; // fallback gray
}

export default function App() {
  const { loading, error, byHour, progress } = useWindborne();
  const [hourIdx, setHourIdx] = useState<number>(0); // 0 = current (00.json)
  const points: Point[] = byHour[hourIdx] || [];

  const [selected, setSelected] = useState<Point | null>(null); // {lat, lon, alt_km}
  const [wx, setWx] = useState<Wx | null>(null); // Open‑Meteo response
  const [wxLoading, setWxLoading] = useState<boolean>(false);
  const [wxErr, setWxErr] = useState<string>("");

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
        </div>
      </div>

      {/* Main Area */}
      <div className="grid md:grid-cols-[2fr_1fr] grid-cols-1 gap-3 p-3">
        <div className="border rounded-xl overflow-hidden bg-white">
          <div className="h-[70vh] md:h-[calc(100vh-150px)]">
            <MapContainer
              center={[20, 0]}
              zoom={3}
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
              {points.map((p, i) => (
                <CircleMarker
                  key={`${p.lat.toFixed(4)}_${p.lon.toFixed(4)}_${i}`}
                  center={[p.lat, p.lon]}
                  radius={3}
                  pathOptions={{
                    color: colorForAlt(p.alt_km),
                    fillColor: colorForAlt(p.alt_km),
                    fillOpacity: 0.9,
                    weight: 1,
                  }}
                  eventHandlers={{ click: () => setSelected(p) } as any}
                >
                  <Popup>
                    <div className="text-sm">
                      <div><b>Lat</b> {p.lat.toFixed(4)} · <b>Lon</b> {p.lon.toFixed(4)}</div>
                      <div><b>Alt</b> {p.alt_km != null ? `${p.alt_km.toFixed(2)} km` : "—"}</div>
                      <div><b>Altitude Range</b> {(() => {
                        const b = ALT_BANDS.find((x) => x.test(p.alt_km));
                        return b ? b.label : "Unknown";
                      })()}</div>
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
                <div className="space-y-3">
                  <WindCompass
                    d10={wx.winddir10m}
                    s10={wx.windspeed10m}
                    d100={wx.winddir100m}
                    s100={wx.windspeed100m}
                  />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span>Ground-level Wind Speed (10m)</span>
                      <b>{Math.round(wx.windspeed10m ?? 0)} m/s</b>
                    </div>
                    {wx.windspeed100m != null && (
                      <div className="flex items-center justify-between">
                        <span>100m Wind Speed</span>
                        <b>{Math.round(wx.windspeed100m)} m/s</b>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span>Temperature</span>
                      <b>{wx.tempC != null ? `${wx.tempC} °C` : "—"}</b>
                    </div>
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

      {/* Altitude Legend */}
      <div className="fixed bottom-4 right-4 z-40">
        <div className="bg-white/95 backdrop-blur rounded-lg shadow p-3 text-xs min-w-[180px]">
          <div className="font-medium mb-2">Altitude Legend (km)</div>
          <ul className="space-y-1">
            {ALT_BANDS.map((b) => (
              <li key={b.label} className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm border" style={{ background: b.color, borderColor: b.color }} />
                <span>{b.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {loading && (
        <div className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-lg p-6 w-[360px] max-w-[90vw] text-center">
            <div className="flex items-center justify-center gap-2 mb-3 text-gray-700">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="font-medium">Loading balloon data…</span>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded">
              <div
                className="h-2 rounded bg-blue-600 transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className="mt-2 text-xs text-gray-500">{Math.round(progress * 100)}%</div>
          </div>
        </div>
      )}
    </div>
  );
}
