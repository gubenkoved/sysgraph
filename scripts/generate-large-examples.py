#!/usr/bin/env python3
"""Rebuild the large, source-backed example graphs with Python's standard library.

Sources are pinned by content hash. Raw downloads stay in .tmp/example-sources;
only the compact, browser-ready JSON files in data/ are committed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import lzma
import math
import random
import re
import struct
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Iterator

ROOT = Path(__file__).resolve().parent.parent
OPENFLIGHTS_COMMIT = "7d1a611e070295dba776d6afb86e57d0d1aa1cef"
SOURCES = {
    "airports.dat": (
        f"https://raw.githubusercontent.com/jpatokal/openflights/{OPENFLIGHTS_COMMIT}/data/airports.dat",
        "9387cdb38df5bd664da823f8ccb69fdd9b33a1888f5b7cca09c34a3cd9ff59f9",
    ),
    "routes.dat": (
        f"https://raw.githubusercontent.com/jpatokal/openflights/{OPENFLIGHTS_COMMIT}/data/routes.dat",
        "bd373706238134f619c624c606dccc74c05c2582a977c489c81de501735f2390",
    ),
    "census-migration.txt": (
        "https://www2.census.gov/programs-surveys/demo/tables/geographic-mobility/2020/"
        "county-to-county-migration-2016-2020/county-to-county-migration-flows/CtyxCty_US.txt",
        "5ae6da9e1cf57849bfdb1f5b34e80c1279ffad8a833942f259cbe0aff345fcd9",
    ),
    "census-counties.zip": (
        "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/"
        "2020_Gaz_counties_national.zip",
        "02ef546e4c4f9c032c19616eabb9526caa016f778f41ede3b8c9755dacce20ef",
    ),
    "debian-packages.xz": (
        "https://deb.debian.org/debian/dists/bookworm/main/binary-amd64/by-hash/SHA256/"
        "9e0b5aabb2465b3d2e7a7fe27f9913846277833f7a2826e7767acccff5b588c5",
        "9e0b5aabb2465b3d2e7a7fe27f9913846277833f7a2826e7767acccff5b588c5",
    ),
    "debian-sources.xz": (
        "https://deb.debian.org/debian/dists/bookworm/main/source/by-hash/SHA256/"
        "92d11a035571df011f06f28c61cb9825130ef1d92abb2f2e0525e8674dc44af8",
        "92d11a035571df011f06f28c61cb9825130ef1d92abb2f2e0525e8674dc44af8",
    ),
    "nyc-edges-36005.zip": (
        "https://www2.census.gov/geo/tiger/TIGER2024/EDGES/tl_2024_36005_edges.zip",
        "acd364a718aa63ac0f3e9d3e9ccf358dc096455a3fdcb00d3032babac5e45dd6",
    ),
    "nyc-edges-36047.zip": (
        "https://www2.census.gov/geo/tiger/TIGER2024/EDGES/tl_2024_36047_edges.zip",
        "1e7b835da2fad69925b6ebbc3a428a0a1c1eac856f7b379db683cc4eec478782",
    ),
    "nyc-edges-36061.zip": (
        "https://www2.census.gov/geo/tiger/TIGER2024/EDGES/tl_2024_36061_edges.zip",
        "421b994589afed47416d1618741f98b0178ee3228a23100e9d84248da1e8072c",
    ),
    "nyc-edges-36081.zip": (
        "https://www2.census.gov/geo/tiger/TIGER2024/EDGES/tl_2024_36081_edges.zip",
        "bbdff5b38812203960578cf73e35b0f34c89ce3e24478e9092b9899581fcb9aa",
    ),
    "nyc-edges-36085.zip": (
        "https://www2.census.gov/geo/tiger/TIGER2024/EDGES/tl_2024_36085_edges.zip",
        "974ef697638f1a62aa2bcc11aa719870f322fa62e085044309bf0e104048e267",
    ),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source(name: str, cache: Path) -> Path:
    url, expected = SOURCES[name]
    path = cache / name
    if path.exists() and sha256(path) == expected:
        return path
    cache.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".download")
    request = urllib.request.Request(url, headers={"User-Agent": "sysgraph-example-builder/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
        for chunk in iter(lambda: response.read(1024 * 1024), b""):
            output.write(chunk)
    actual = sha256(temporary)
    if actual != expected:
        temporary.unlink()
        raise ValueError(f"{name} changed: expected SHA-256 {expected}, got {actual}")
    temporary.replace(path)
    return path


def rgba(value: str, alpha: float) -> dict[str, float | int]:
    return {"r": int(value[1:3], 16), "g": int(value[3:5], 16),
            "b": int(value[5:7], 16), "a": alpha}


def haversine_km(first: tuple[float, float], second: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, first)
    lat2, lon2 = map(math.radians, second)
    delta_lat, delta_lon = lat2 - lat1, lon2 - lon1
    value = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    return 6371.0088 * 2 * math.asin(min(1, math.sqrt(value)))


def read_csv(path: Path) -> Iterator[list[str]]:
    with path.open(newline="", encoding="utf-8") as stream:
        yield from csv.reader(stream)


def world_airline_routes(cache: Path) -> dict:
    airports = {}
    by_iata: dict[str, list[str]] = defaultdict(list)
    for row in read_csv(source("airports.dat", cache)):
        if len(row) != 14 or row[0] in ("", "\\N"):
            continue
        try:
            lat, lon = float(row[6]), float(row[7])
        except ValueError:
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        airports[row[0]] = row
        if row[4] not in ("", "\\N"):
            by_iata[row[4]].append(row[0])

    def airport_id(id_value: str, iata: str) -> str | None:
        if id_value in airports:
            return id_value
        matches = by_iata.get(iata, [])
        return matches[0] if len(matches) == 1 else None

    routes = []
    used = set()
    seen = set()
    for row in read_csv(source("routes.dat", cache)):
        if len(row) != 9:
            continue
        start = airport_id(row[3], row[2])
        end = airport_id(row[5], row[4])
        if start is None or end is None or start == end:
            continue
        airline = row[0] if row[0] != "\\N" else ""
        stops = int(row[7]) if row[7].isdigit() else 0
        key = (start, end, airline, stops, row[8])
        if key in seen:
            continue
        seen.add(key)
        routes.append((start, end, airline, stops))
        used.update((start, end))

    ids = sorted(used, key=int)
    positions = {airport: index for index, airport in enumerate(ids)}
    degree = defaultdict(int)
    for start, end, _, _ in routes:
        degree[start] += 1
        degree[end] += 1
    nodes = []
    coordinates = {}
    for airport in ids:
        row = airports[airport]
        lat, lon = float(row[6]), float(row[7])
        coordinates[airport] = (lat, lon)
        code = row[4] if row[4] != "\\N" else row[5] if row[5] != "\\N" else row[0]
        nodes.append({
            "id": f"airport:{airport}", "type": "airport",
            "x": round(lon * 6, 2), "y": round(-lat * 6, 2),
            "properties": {"label": f"{code} · {row[2]}", "code": code,
                           "name": row[1], "city": row[2], "country": row[3],
                           "lat": lat, "lon": lon, "routes": degree[airport]},
        })
    edges = [[positions[start], positions[end], 0, airline, stops,
              round(haversine_km(coordinates[start], coordinates[end]), 1)]
             for start, end, airline, stops in routes]
    return {
        "metadata": {"title": "World Airline Routes", "rank": 7,
                     "source": f"https://github.com/jpatokal/openflights/tree/{OPENFLIGHTS_COMMIT}/data",
                     "license": "ODbL-1.0; database contents under DbCL-1.0",
                     "badges": [{"text": "global", "icon": "public", "tone": "info"}]},
        "display": {"gpuEnablePhysics": False, "gpuWarmupMs": 0, "gpuEdgeStyle": "thin",
                    "gpuEdgeWidth": 1, "gpuLinkDistanceMode": "expression",
                    "gpuLinkDistanceExpression": "Number(properties.distance_km) * 0.08",
                    "nodeLabelMode": "expression", "nodeLabelExpression": "properties.label",
                    "labelDensity": "focus", "nodeSizingMode": "expression",
                    "nodeSizingExpression": "Math.sqrt(Math.max(1, degree))",
                    "nodeSizeScale": 0.6,
                    "nodeColors": {"airport": rgba("#2876b9", 0.95)},
                    "edgeColors": {"route": rgba("#4387ae", 0.11)}},
        "edgeEncoding": "indexed-v1", "edgeTypes": ["route"],
        "edgeProperties": ["airline", "stops", "distance_km"],
        "nodes": nodes, "edges": edges,
    }


NORTHEAST = set("CT ME MA NH RI VT NJ NY PA".split())
MIDWEST = set("IL IN MI OH WI IA KS MN MO NE ND SD".split())
SOUTH = set("DE DC FL GA MD NC SC VA WV AL KY MS TN AR LA OK TX".split())


def county_region(state: str) -> str:
    if state == "PR":
        return "Puerto Rico"
    if state in NORTHEAST:
        return "Northeast"
    if state in MIDWEST:
        return "Midwest"
    if state in SOUTH:
        return "South"
    return "West"


def county_position(state: str, lat: float, lon: float) -> tuple[float, float]:
    # Alaska, Hawaii, and Puerto Rico are inset to keep the contiguous states legible.
    if state == "AK":
        if lon > 0:  # Aleutian islands cross the antimeridian.
            lon -= 360
        return -510 + (lon + 153) * 6, 385 - (lat - 64) * 6
    if state == "HI":
        return -300 + (lon + 157) * 20, 380 - (lat - 20) * 20
    if state == "PR":
        return 570 + (lon + 66) * 16, 375 - (lat - 18) * 16
    return (lon + 96) * 18, -(lat - 37) * 24


def county_migration(cache: Path) -> dict:
    with zipfile.ZipFile(source("census-counties.zip", cache)) as archive:
        with archive.open("2020_Gaz_counties_national.txt") as file:
            rows = csv.DictReader(io.TextIOWrapper(file, encoding="utf-8-sig"), delimiter="\t")
            counties = {}
            for raw_row in rows:
                row = {key.strip(): value.strip() for key, value in raw_row.items()}
                counties[row["GEOID"]] = row

    records = []
    population_1y_plus = {}
    with source("census-migration.txt", cache).open(encoding="latin1") as stream:
        for line in stream:
            # Fixed-width positions are 1-based in the Census documentation.
            current = line[1:3] + line[3:6]
            previous = line[7:9] + line[9:12]
            estimate, margin = line[373:380].strip(), line[381:388].strip()
            if (current not in counties or previous not in counties or current == previous or
                    not estimate.isdecimal() or int(estimate) <= 0 or not margin.isdecimal()):
                continue
            residents = line[79:87].strip()
            if residents.isdecimal():
                population_1y_plus[current] = int(residents)
            records.append((previous, current, int(estimate), int(margin)))

    ids = sorted({item for previous, current, _, _ in records for item in (previous, current)})
    positions = {county: index for index, county in enumerate(ids)}
    coordinates = {}
    nodes = []
    for county in ids:
        row = counties[county]
        lat, lon = float(row["INTPTLAT"]), float(row["INTPTLONG"])
        state = row["USPS"]
        coordinates[county] = (lat, lon)
        x, y = county_position(state, lat, lon)
        nodes.append({"id": county, "type": county_region(state),
                      "x": round(x, 2), "y": round(y, 2),
                      "properties": {"label": f"{row['NAME']}, {state}",
                                     "county": row["NAME"], "state": state,
                                     "fips": county,
                                     "population_1y_plus": population_1y_plus.get(county),
                                     "lat": lat, "lon": lon}})
    edges = [[positions[previous], positions[current],
              0 if previous[:2] == current[:2] else 1,
              estimate, margin,
              round(haversine_km(coordinates[previous], coordinates[current]), 1)]
             for previous, current, estimate, margin in records]
    return {
        "metadata": {"title": "US County Migration (2016–2020)", "rank": 8,
                     "source": SOURCES["census-migration.txt"][0],
                     "license": "U.S. Census Bureau public data",
                     "badges": [{"text": "estimates", "icon": "route", "tone": "info"}]},
        "display": {"gpuEnablePhysics": False, "gpuWarmupMs": 0, "gpuEdgeStyle": "thin",
                    "gpuEdgeWidth": 1, "gpuLinkDistanceMode": "expression",
                    "gpuLinkDistanceExpression": "Number(properties.distance_km) * 0.08",
                    "nodeLabelMode": "expression", "nodeLabelExpression": "properties.label",
                    "labelDensity": "focus", "nodeSizingMode": "expression",
                    "nodeSizingExpression": "Math.sqrt(Math.max(1, degree))",
                    "nodeSizeScale": 0.45,
                    "nodeColors": {"Northeast": rgba("#4686b2", 0.95),
                                   "Midwest": rgba("#6d9a56", 0.95),
                                   "South": rgba("#d07854", 0.95),
                                   "West": rgba("#8b72b7", 0.95),
                                   "Puerto Rico": rgba("#b99645", 0.95)},
                    "edgeColors": {"within-state": rgba("#4c7f9d", 0.06),
                                   "between-states": rgba("#9a8193", 0.035)}},
        "edgeEncoding": "indexed-v1",
        "edgeTypes": ["within-state", "between-states"],
        "edgeProperties": ["movers_estimate", "moe_90", "distance_km"],
        "nodes": nodes, "edges": edges,
    }


def debian_paragraphs(path: Path) -> Iterator[dict[str, str]]:
    with lzma.open(path, "rt", encoding="utf-8") as stream:
        paragraph: dict[str, str] = {}
        key = None
        for line in stream:
            if line == "\n":
                if paragraph:
                    yield paragraph
                paragraph, key = {}, None
            elif line[0].isspace():
                if key:
                    paragraph[key] += "\n" + line.strip()
            else:
                name, separator, value = line.partition(":")
                if separator:
                    key = name
                    paragraph[name] = value.strip()
        if paragraph:
            yield paragraph


DEPENDENCY_NAME = re.compile(r"\s*([a-z0-9][a-z0-9+.-]*)(?::[a-z]+)?")


def dependency_targets(raw: str, available: set[str]) -> Iterator[str]:
    # Debian clauses may contain alternatives and version/architecture guards.
    # Take the first alternative present in this amd64 package index. This is a
    # representative dependency, not a complete solver for virtual packages.
    for clause in raw.replace("\n", " ").split(","):
        candidates = [match.group(1) for alternative in clause.split("|")
                      if (match := DEPENDENCY_NAME.match(alternative))]
        target = next((name for name in candidates if name in available), None)
        if target:
            yield target


def package_group(section: str) -> str:
    section = section.removeprefix("main/")
    if section in {"libs", "libdevel"}:
        return "Libraries"
    if section == "python":
        return "Python"
    if section == "perl":
        return "Perl"
    if section in {"javascript", "nodejs", "web"}:
        return "Web"
    if section == "rust":
        return "Rust"
    if section == "golang":
        return "Go"
    if section in {"devel", "vcs", "interpreters", "debug"}:
        return "Development"
    if section in {"admin", "utils", "net", "kernel", "shells", "base", "database"}:
        return "System"
    if section in {"x11", "gnome", "kde", "graphics", "video", "sound", "fonts"}:
        return "Desktop"
    if section in {"science", "math", "education", "electronics", "tex"}:
        return "Science"
    if section in {"java", "haskell", "ruby", "gnu-r", "ocaml", "lisp", "php", "erlang",
                   "ada", "scheme"}:
        return "Language ecosystems"
    if section in {"doc", "text", "localization"}:
        return "Documentation"
    if section == "games":
        return "Games"
    return "Miscellaneous"


def package_positions(names: list[str], groups: dict[str, str]) -> dict[str, tuple[float, float]]:
    outer = ["Python", "Perl", "Web", "Rust", "Go", "Development", "System",
             "Desktop", "Science", "Language ecosystems", "Documentation",
             "Games", "Miscellaneous"]
    members: dict[str, list[str]] = defaultdict(list)
    for name in names:
        members[groups[name]].append(name)
    result = {}
    for group, packages in members.items():
        if group == "Libraries":
            center_x = center_y = 0.0
        else:
            angle = outer.index(group) * 2 * math.pi / len(outer) - math.pi / 2
            center_x, center_y = 2800 * math.cos(angle), 2800 * math.sin(angle)
        radius = max(120, math.sqrt(len(packages)) * 6)
        for index, name in enumerate(packages):
            angle = index * 2.399963229728653
            distance = radius * math.sqrt((index + 0.5) / len(packages))
            result[name] = (round(center_x + math.cos(angle) * distance, 2),
                            round(center_y + math.sin(angle) * distance, 2))
    return result


def debian_packages(cache: Path) -> dict:
    binaries = {record["Package"]: record for record in
                debian_paragraphs(source("debian-packages.xz", cache)) if "Package" in record}
    source_packages = {record["Package"]: record for record in
                       debian_paragraphs(source("debian-sources.xz", cache)) if "Package" in record}
    names = sorted(binaries.keys() | source_packages.keys())
    positions = {name: index for index, name in enumerate(names)}
    groups = {name: package_group((binaries.get(name) or source_packages[name]).get("Section", ""))
              for name in names}
    points = package_positions(names, groups)
    group_heights = {"Libraries": 0, "Python": 260, "Perl": 180, "Web": 100,
                     "Rust": 320, "Go": 220, "Development": 160, "System": -50,
                     "Desktop": -180, "Science": 280, "Language ecosystems": 220,
                     "Documentation": -300, "Games": -420, "Miscellaneous": -240}
    nodes = []
    for index, name in enumerate(names):
        binary, source_record = binaries.get(name), source_packages.get(name)
        record = binary or source_record
        assert record is not None
        description = (binary or {}).get("Description", "").split("\n", 1)[0]
        kind = "both" if binary and source_record else "binary" if binary else "source"
        x, y = points[name]
        z = group_heights[groups[name]] + {"source": 110, "binary": -70, "both": 0}[kind]
        z += 28 * math.sin(index * 2.399963229728653)
        nodes.append({"id": name, "type": groups[name], "x": x, "y": y,
                      "z": round(z, 2),
                      "properties": {"label": name, "kind": kind,
                                     "section": record.get("Section", ""),
                                     "summary": description}})

    available = set(binaries)
    edge_types = ["depends", "pre-depends", "build-depends", "produces"]
    edges = []
    seen = set()

    def add(start: str, end: str, type_index: int) -> None:
        key = (start, end, type_index)
        if start != end and key not in seen:
            seen.add(key)
            edges.append([positions[start], positions[end], type_index])

    for name in sorted(binaries):
        record = binaries[name]
        for field, type_index in (("Depends", 0), ("Pre-Depends", 1)):
            for target in dependency_targets(record.get(field, ""), available):
                add(name, target, type_index)
    for name in sorted(source_packages):
        record = source_packages[name]
        for target in dependency_targets(record.get("Build-Depends", ""), available):
            add(name, target, 2)
        for output in record.get("Binary", "").replace("\n", " ").split(","):
            output = output.strip()
            if output in available and output != name:
                add(name, output, 3)

    palette = {"Libraries": "#4b79b7", "Python": "#b59a32", "Perl": "#ad6a9c",
               "Web": "#32959a", "Rust": "#b77755", "Go": "#5c9cbe",
               "Development": "#8466b5", "System": "#548d6d", "Desktop": "#a86d7d",
               "Science": "#6b8aaf", "Language ecosystems": "#a48a61",
               "Documentation": "#8795a3", "Games": "#bd8061",
               "Miscellaneous": "#84909b"}
    return {
        "metadata": {"title": "Debian Package Ecosystem", "rank": 9,
                     "source": "https://deb.debian.org/debian/dists/bookworm/main/",
                     "license": "Debian archive metadata; see per-package licenses",
                     "badges": [{"text": "large", "icon": "warning", "tone": "warning"}]},
        "display": {"layoutMode": "force", "gpuEnablePhysics": True,
                    "gpuWarmupMs": 0, "gpuEdgeStyle": "thin",
                    "gpuEdgeWidth": 1, "nodeLabelMode": "expression",
                    "nodeLabelExpression": "properties.label", "labelDensity": "focus",
                    "nodeSizingMode": "constant", "nodeSizingConstant": 2,
                    "nodeColors": {group: rgba(color, 0.92) for group, color in palette.items()},
                    "edgeColors": {"depends": rgba("#7a96ac", 0.075),
                                   "pre-depends": rgba("#a7745f", 0.12),
                                   "build-depends": rgba("#9a83b4", 0.045),
                                   "produces": rgba("#67a38c", 0.11)}},
        "edgeEncoding": "indexed-v1", "edgeTypes": edge_types,
        "edgeProperties": [], "nodes": nodes, "edges": edges,
    }


NYC_BOROUGHS = {"36005": "Bronx", "36047": "Brooklyn", "36061": "Manhattan",
                "36081": "Queens", "36085": "Staten Island"}


def dbf_rows(data: bytes) -> Iterator[dict[str, str]]:
    count = struct.unpack_from("<I", data, 4)[0]
    header_length, row_length = struct.unpack_from("<HH", data, 8)
    fields = []
    offset = 1
    for cursor in range(32, header_length, 32):
        if data[cursor] == 13:
            break
        name = data[cursor:cursor + 11].split(b"\0", 1)[0].decode("ascii")
        width = data[cursor + 16]
        fields.append((name, offset, width))
        offset += width
    for index in range(count):
        row = data[header_length + index * row_length:header_length + (index + 1) * row_length]
        if row[:1] == b"*":
            yield {}
        else:
            yield {name: row[start:start + width].decode("latin1").strip()
                   for name, start, width in fields}


def polyline_rows(data: bytes) -> Iterator[list[list[tuple[float, float]]]]:
    cursor = 100
    while cursor + 8 <= len(data):
        length = struct.unpack_from(">I", data, cursor + 4)[0] * 2
        record = cursor + 8
        if struct.unpack_from("<I", data, record)[0] != 3:
            yield []
        else:
            part_count, point_count = struct.unpack_from("<II", data, record + 36)
            parts = [struct.unpack_from("<I", data, record + 44 + i * 4)[0]
                     for i in range(part_count)] + [point_count]
            points_start = record + 44 + part_count * 4
            points = list(struct.iter_unpack("<dd", data[points_start:points_start + point_count * 16]))
            yield [points[parts[i]:parts[i + 1]] for i in range(part_count)]
        cursor = record + length


def street_class(mtfcc: str) -> str:
    if mtfcc == "S1100":
        return "highway"
    if mtfcc == "S1200":
        return "arterial"
    if mtfcc == "S1400":
        return "street"
    if mtfcc in {"S1630", "S1640"}:
        return "ramp"
    if mtfcc.startswith("S17"):
        return "path"
    return "other"


def nyc_streets(cache: Path) -> dict:
    nodes = []
    edges = []
    endpoints: dict[str, int] = {}
    junction_names: dict[int, set[str]] = defaultdict(set)
    seen_edges = set()
    edge_types = ["street", "ramp", "path", "arterial", "highway", "other"]
    type_index = {name: index for index, name in enumerate(edge_types)}

    def node_for(point: tuple[float, float], borough: str, street: str,
                 topology_id: str | None) -> int:
        lon, lat = point
        if topology_id is not None and topology_id in endpoints:
            index = endpoints[topology_id]
            if street != "Unnamed":
                junction_names[index].add(street)
            return index
        index = len(nodes)
        x = (lon + 73.98) * 2125
        y = -(lat - 40.72) * 2775
        # Stylized relief adds spatial depth; TIGER/Line contains no elevation.
        z = 45 * math.sin(x / 180) * math.cos(y / 230) + 18 * math.cos((x + y) / 90)
        nodes.append({"id": f"s{index}", "type": borough,
                      "x": round(x, 2), "y": round(y, 2), "z": round(z, 2),
                      "properties": {"street": street, "borough": borough,
                                     "role": "junction" if topology_id else "bend"}})
        if topology_id is not None:
            endpoints[topology_id] = index
            if street != "Unnamed":
                junction_names[index].add(street)
        return index

    for fips, borough in NYC_BOROUGHS.items():
        with zipfile.ZipFile(source(f"nyc-edges-{fips}.zip", cache)) as archive:
            stem = f"tl_2024_{fips}_edges"
            attributes = dbf_rows(archive.read(f"{stem}.dbf"))
            geometry = polyline_rows(archive.read(f"{stem}.shp"))
            for row, parts in zip(attributes, geometry, strict=True):
                if not row or row["ROADFLG"] != "Y" or row["TLID"] in seen_edges:
                    continue
                seen_edges.add(row["TLID"])
                street = row["FULLNAME"] or "Unnamed"
                category = street_class(row["MTFCC"])
                for part in parts:
                    clean = [point for i, point in enumerate(part)
                             if i == 0 or point != part[i - 1]]
                    if len(clean) < 2:
                        continue
                    indices = [node_for(point, borough, street,
                                        row["TNIDF"] if i == 0 else
                                        row["TNIDT"] if i == len(clean) - 1 else None)
                               for i, point in enumerate(clean)]
                    for i in range(len(indices) - 1):
                        lon1, lat1 = clean[i]
                        lon2, lat2 = clean[i + 1]
                        length = math.hypot((lon2 - lon1) * 85000,
                                            (lat2 - lat1) * 111000)
                        if indices[i] != indices[i + 1]:
                            edges.append([indices[i], indices[i + 1], type_index[category],
                                          street, borough, round(length, 1)])

    for index, names in junction_names.items():
        if len(names) > 1:
            street = " / ".join(sorted(names)[:3])
            nodes[index]["properties"]["street"] = street

    palette = {"Bronx": "#9b7966", "Brooklyn": "#6c8ea9",
               "Manhattan": "#c38b50", "Queens": "#658f83",
               "Staten Island": "#8d80a6"}
    return {
        "metadata": {"title": "New York City Streets (2024)", "rank": 7.4,
                     "source": "https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/tiger-geo-line.2024.html",
                     "license": "U.S. Census Bureau public data",
                     "badges": [{"text": "2D map", "icon": "map", "tone": "info"}]},
        "display": {"gpuEnablePhysics": False, "gpuWarmupMs": 0,
                    "gpuEdgeStyle": "thin", "gpuEdgeWidth": 0.7,
                    "nodeLabelMode": "expression",
                    "nodeLabelExpression": "properties.street",
                    "labelDensity": "focus", "nodeSizingMode": "constant",
                    "nodeSizingConstant": 0.5, "nodeSizeScale": 0.45,
                    "nodeColors": {name: rgba(color, 0.5) for name, color in palette.items()},
                    "edgeColors": {"street": rgba("#718393", 0.28),
                                   "ramp": rgba("#a77e5d", 0.42),
                                   "path": rgba("#719782", 0.34),
                                   "arterial": rgba("#aa7b4a", 0.55),
                                   "highway": rgba("#b0674c", 0.7),
                                   "other": rgba("#8c98a0", 0.22)}},
        "edgeEncoding": "indexed-v1", "edgeTypes": edge_types,
        "edgeProperties": ["street", "borough", "length_m"],
        "nodes": nodes, "edges": edges,
    }


def spiral_trade_routes(_cache: Path) -> dict:
    """A reproducible spatial network with sparse links between six arms."""
    rng = random.Random(20241003)
    arms = ["Aster", "Cinder", "Delta", "Indigo", "Moss", "Sable"]
    palette = {"Aster": "#cd805d", "Cinder": "#b8a05a", "Delta": "#6b9db3",
               "Indigo": "#7d82be", "Moss": "#6eaa8a", "Sable": "#aa7ba4",
               "Core": "#e0aa55"}
    nodes = []
    edges = []
    seen = set()
    edge_types = ["local", "express", "cross-arm", "core"]

    def add(start: int, end: int, kind: int) -> None:
        key = (min(start, end), max(start, end), kind)
        if start == end or key in seen:
            return
        seen.add(key)
        a, b = nodes[start], nodes[end]
        length = math.dist((a["x"], a["y"], a["z"]),
                           (b["x"], b["y"], b["z"]))
        edges.append([start, end, kind, round(length, 1)])

    core_count = 240
    for index in range(core_count):
        angle = 2 * math.pi * index / core_count
        radius = 65 + 25 * math.sin(angle * 7)
        x, y = radius * math.cos(angle), radius * math.sin(angle)
        z = 250 + 55 * math.sin(angle * 3)
        nodes.append({"id": f"core:{index}", "type": "Core",
                      "x": round(x, 2), "y": round(y, 2), "z": round(z, 2),
                      "properties": {"label": f"Core relay {index:03d}",
                                     "arm": "Core", "sector": 0,
                                     "role": "relay"}})
    for index in range(core_count):
        add(index, (index + 1) % core_count, 3)
        add(index, (index + 7) % core_count, 3)

    per_arm = 3600
    arm_start = {}
    for arm_index, arm in enumerate(arms):
        arm_start[arm] = len(nodes)
        for index in range(per_arm):
            t = index / (per_arm - 1)
            radius = 145 + 1590 * t
            angle = arm_index * 2 * math.pi / len(arms) + 2.35 * math.pi * t
            side = rng.gauss(0, 11 + 34 * t)
            x = radius * math.cos(angle) - side * math.sin(angle)
            y = radius * math.sin(angle) + side * math.cos(angle)
            z = (arm_index - 2.5) * 80 + 170 * (1 - t) ** 2
            z += rng.gauss(0, 9 + 23 * t)
            role = "relay" if index % 90 == 0 else "station"
            nodes.append({"id": f"{arm.lower()}:{index}", "type": arm,
                          "x": round(x, 2), "y": round(y, 2), "z": round(z, 2),
                          "properties": {"label": f"{arm} · {index // 450 + 1:02d}-{index % 450:03d}",
                                         "arm": arm, "sector": index // 450 + 1,
                                         "role": role}})
        start = arm_start[arm]
        for index in range(per_arm):
            for step in (1, 3, 8, 18):
                if index + step < per_arm:
                    add(start + index, start + index + step, 0)
            if index % 90 == 0 and index + 75 < per_arm:
                add(start + index, start + index + 75, 1)
        for index in range(0, 45, 3):
            add(start + index, (arm_index * core_count // len(arms) + index) % core_count, 3)

    # Bridges are sparse on purpose: path finding exposes their strategic role.
    for arm_index, arm in enumerate(arms):
        next_arm = arms[(arm_index + 1) % len(arms)]
        for sector in range(1, 8):
            for offset in (0, 15, 30):
                a = arm_start[arm] + sector * 450 + offset
                b = arm_start[next_arm] + sector * 450 + offset
                add(a, b, 2)

    return {
        "metadata": {"title": "Spiral Trade Routes", "rank": 7.2,
                     "source": "Deterministic procedural example",
                     "license": "MIT",
                     "badges": [{"text": "synthetic", "icon": "hub", "tone": "info"}]},
        "display": {"gpuEnablePhysics": False, "gpuWarmupMs": 0,
                    "gpuEdgeStyle": "thin", "gpuEdgeWidth": 0.85,
                    "nodeLabelMode": "expression",
                    "nodeLabelExpression": "properties.label",
                    "labelDensity": "focus", "nodeSizingMode": "expression",
                    "nodeSizingExpression": "properties.role === 'relay' ? 4 : 1",
                    "nodeSizeScale": 0.5,
                    "nodeColors": {name: rgba(color, 0.9) for name, color in palette.items()},
                    "edgeColors": {"local": rgba("#7590a0", 0.14),
                                   "express": rgba("#f0b455", 0.34),
                                   "cross-arm": rgba("#cc6d8f", 0.45),
                                   "core": rgba("#d6a75c", 0.3)}},
        "edgeEncoding": "indexed-v1", "edgeTypes": edge_types,
        "edgeProperties": ["length"], "nodes": nodes, "edges": edges,
    }


def write_example(graph: dict, path: Path) -> None:
    nodes, edges = graph["nodes"], graph["edges"]
    if not nodes or not edges or len(edges) > 500_000:
        raise ValueError(f"Unexpected graph size: {len(nodes)} nodes, {len(edges)} edges")
    if len({node["id"] for node in nodes}) != len(nodes):
        raise ValueError("Duplicate node IDs")
    for index, (source_index, target_index, type_index, *_rest) in enumerate(edges):
        if not (0 <= source_index < len(nodes) and 0 <= target_index < len(nodes) and
                0 <= type_index < len(graph["edgeTypes"])):
            raise ValueError(f"Dangling edge at {index}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output:
        json.dump(graph, output, ensure_ascii=False, separators=(",", ":"))
        output.write("\n")
    print(f"{path}: {len(nodes):,} nodes, {len(edges):,} edges, {path.stat().st_size / 1e6:.1f} MB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=ROOT / ".tmp" / "example-sources")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--only", choices=("airlines", "migration", "debian", "nyc", "spiral"))
    args = parser.parse_args()
    builders = [("airlines", world_airline_routes, "world-airline-routes.json"),
                ("migration", county_migration, "us-county-migration.json"),
                ("debian", debian_packages, "debian-package-ecosystem.json"),
                ("nyc", nyc_streets, "nyc-streets.json"),
                ("spiral", spiral_trade_routes, "spiral-trade-routes.json")]
    for name, build, filename in builders:
        if args.only and args.only != name:
            continue
        write_example(build(args.cache_dir), args.output_dir / filename)


if __name__ == "__main__":
    main()
