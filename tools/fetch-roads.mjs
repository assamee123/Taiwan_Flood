// One-time extractor: OSM roads for the DEM bounding box -> data/roads.geojson
// Usage: node tools/fetch-roads.mjs
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const meta = JSON.parse(readFileSync(join(root, "data/meta.json"), "utf8"));
const BBOX = `(${meta.south},${meta.west},${meta.north},${meta.east})`;

const CLASSES = [
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
  "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
  "residential", "living_street", "service", "road", "track",
];

const QUERY = `[out:json][timeout:180];
way["highway"~"^(${CLASSES.join("|")})$"]${BBOX};
out geom;`;

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

async function fetchOverpass() {
  let lastErr;
  for (const url of MIRRORS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        process.stderr.write(`-> ${url} (attempt ${attempt})\n`);
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Taiwan_Flood/1.0 (flood road extractor)",
          },
          body: new URLSearchParams({ data: QUERY }),
          signal: AbortSignal.timeout(240_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        if (!Array.isArray(json.elements)) throw new Error("unexpected Overpass payload");
        return json.elements;
      } catch (err) {
        lastErr = err;
        process.stderr.write(`   failed: ${err.message}\n`);
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 5000));
      }
    }
  }
  throw lastErr;
}

const r5 = v => Math.round(v * 1e5) / 1e5;

const elements = await fetchOverpass();
const features = [];
for (const el of elements) {
  if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
  const cls = el.tags && el.tags.highway;
  if (!cls) continue;
  features.push({
    type: "Feature",
    properties: { c: cls },
    geometry: { type: "LineString", coordinates: el.geometry.map(p => [r5(p.lon), r5(p.lat)]) },
  });
}

const out = join(root, "data/roads.geojson");
const geojson = { type: "FeatureCollection", features };
writeFileSync(out, JSON.stringify(geojson));

const vertices = features.reduce((n, f) => n + f.geometry.coordinates.length, 0);
const bytes = Buffer.byteLength(JSON.stringify(geojson));
process.stderr.write(
  `\nwrote ${out}\n  ways: ${features.length}\n  vertices: ${vertices}\n  size: ${(bytes / 1048576).toFixed(2)} MB\n`
);
