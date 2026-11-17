"""Build the SBS extreme weather files from official National Weather Service alerts.

Reads every active NWS alert (api.weather.gov, free, no key), keeps the warnings and
watches that matter to trucking, and turns each one into county shapes so it can be
drawn on a map. Writes three files into the folder given on the command line:

  extreme-weather.geojson         shaded areas for the Azure Map in Power BI
  extreme-weather-counties.csv    one row per alert and county, for the Power BI table
  status.json                     when it ran and how many alerts it found

Standard library only, so it runs on any GitHub Actions runner with no installs.
"""

import csv
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "out")
API = "https://api.weather.gov/alerts/active?status=actual&message_type=alert,update"
UA = "SBS-Command-Center-weather-map (github.com/flightmike70/hello-world)"
CENTRAL = ZoneInfo("America/Chicago")

# Event -> (category, priority 1 = worst, NWS map color). Anything not listed is ignored.
EVENTS = {
    "Tornado Warning": ("Tornado / severe storm", 1, "#FF0000"),
    "Extreme Wind Warning": ("Wind", 1, "#FF8C00"),
    "Hurricane Warning": ("Tropical", 1, "#DC143C"),
    "Storm Surge Warning": ("Tropical", 1, "#B524F7"),
    "Blizzard Warning": ("Winter", 1, "#FF4500"),
    "Ice Storm Warning": ("Winter", 1, "#8B008B"),
    "Flash Flood Warning": ("Flood", 2, "#8B0000"),
    "Tropical Storm Warning": ("Tropical", 2, "#B22222"),
    "Winter Storm Warning": ("Winter", 2, "#FF69B4"),
    "Lake Effect Snow Warning": ("Winter", 2, "#008B8B"),
    "Extreme Cold Warning": ("Cold / heat", 2, "#0000FF"),
    "Severe Thunderstorm Warning": ("Tornado / severe storm", 2, "#FFA500"),
    "High Wind Warning": ("Wind", 2, "#DAA520"),
    "Dust Storm Warning": ("Wind", 2, "#FFE4C4"),
    "Extreme Heat Warning": ("Cold / heat", 3, "#C71585"),
    "Excessive Heat Warning": ("Cold / heat", 3, "#C71585"),
    "Flood Warning": ("Flood", 3, "#00FF00"),
    "Hurricane Watch": ("Tropical", 3, "#FF00FF"),
    "Tornado Watch": ("Tornado / severe storm", 3, "#FFFF00"),
    "Winter Storm Watch": ("Winter", 4, "#4682B4"),
    "Blizzard Watch": ("Winter", 4, "#ADFF2F"),
    "Tropical Storm Watch": ("Tropical", 4, "#F08080"),
    "Severe Thunderstorm Watch": ("Tornado / severe storm", 4, "#DB7093"),
    "High Wind Watch": ("Wind", 4, "#B8860B"),
    "Flash Flood Watch": ("Flood", 4, "#2E8B57"),
    "Flood Watch": ("Flood", 4, "#2E8B57"),
    "Extreme Cold Watch": ("Cold / heat", 4, "#5F9EA0"),
}

STATES = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
    "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
    "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
    "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
    "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
    "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
    "55": "WI", "56": "WY", "72": "PR",
}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/geo+json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def central(iso):
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso).astimezone(CENTRAL).strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return ""


def centroid(geom):
    """Average of outer ring points: good enough to place a county for distance checks."""
    pts = []
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for poly in polys:
        pts.extend(poly[0])
    if not pts:
        return None, None
    return round(sum(p[1] for p in pts) / len(pts), 4), round(sum(p[0] for p in pts) / len(pts), 4)


def main():
    os.makedirs(OUT, exist_ok=True)
    counties = {}
    with open(os.path.join(HERE, "us-counties.geojson"), encoding="utf-8") as f:
        for ft in json.load(f)["features"]:
            lat, lon = centroid(ft["geometry"])
            counties[ft["properties"]["fips"]] = (ft, lat, lon)

    alerts = fetch(API)["features"]
    now = datetime.now(timezone.utc)

    rows = []          # one per alert x county
    by_county = {}     # fips -> worst alert covering it (for the shaded map)
    storm_shapes = []  # storm-based warnings drawn with their own polygon
    kept = 0

    for a in alerts:
        p = a["properties"]
        ev = p.get("event")
        if ev not in EVENTS:
            continue
        ends = p.get("ends") or p.get("expires")
        if ends:
            try:
                if datetime.fromisoformat(ends) < now:
                    continue
            except ValueError:
                pass
        cat, pri, color = EVENTS[ev]
        info = {
            "event": ev, "category": cat, "priority": pri, "color": color,
            "headline": (p.get("headline") or "")[:250],
            "severity": p.get("severity") or "",
            "onset": central(p.get("onset") or p.get("effective")),
            "ends": central(ends),
            "id": p.get("id", ""),
        }
        fips_list = []
        for same in (p.get("geocode") or {}).get("SAME", []):
            same = same.strip()
            if len(same) == 6 and same[1:3] in STATES:
                fips_list.append(same[1:])
        land = [f for f in dict.fromkeys(fips_list) if f in counties]
        if not land and not a.get("geometry"):
            continue  # marine or unmatched area: skip
        kept += 1

        if a.get("geometry"):
            storm_shapes.append({"type": "Feature", "geometry": a["geometry"], "properties": style(info, 0.55)})

        for fips in land:
            ft, lat, lon = counties[fips]
            name = ft["properties"]["name"]
            st = STATES[fips[:2]]
            rows.append({
                "Alert Id": info["id"], "Event": ev, "Category": cat, "Priority": pri,
                "Severity": info["severity"], "State": st, "County": name, "FIPS": fips,
                "Lat": lat, "Lon": lon, "Starts CT": info["onset"], "Ends CT": info["ends"],
                "Headline": info["headline"],
            })
            cur = by_county.get(fips)
            if cur is None or pri < cur["priority"]:
                by_county[fips] = dict(info, county=f"{name}, {st}")

    features = []
    for fips, info in by_county.items():
        ft = counties[fips][0]
        props = style(info, 0.45)
        props["area"] = info["county"]
        features.append({"type": "Feature", "geometry": ft["geometry"], "properties": props})
    features.extend(storm_shapes)

    with open(os.path.join(OUT, "extreme-weather.geojson"), "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))

    cols = ["Alert Id", "Event", "Category", "Priority", "Severity", "State", "County", "FIPS",
            "Lat", "Lon", "Starts CT", "Ends CT", "Headline"]
    rows.sort(key=lambda r: (r["Priority"], r["Event"], r["State"], r["County"]))
    with open(os.path.join(OUT, "extreme-weather-counties.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)

    status = {
        "updated_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "updated_ct": now.astimezone(CENTRAL).strftime("%Y-%m-%d %H:%M"),
        "alerts": kept, "counties": len(by_county), "rows": len(rows),
        "source": "National Weather Service, api.weather.gov",
    }
    with open(os.path.join(OUT, "status.json"), "w", encoding="utf-8") as f:
        json.dump(status, f, indent=2)
    print(json.dumps(status))


def style(info, opacity):
    return {
        "event": info["event"], "category": info["category"], "priority": info["priority"],
        "ends": info["ends"], "headline": info["headline"],
        "fillColor": info["color"], "fillOpacity": opacity,
        "strokeColor": info["color"], "strokeWidth": 1,
    }


if __name__ == "__main__":
    main()
