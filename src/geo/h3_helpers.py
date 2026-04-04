import h3
from shapely.geometry import shape, Polygon, MultiPolygon
from typing import Iterable, Tuple, List, Set


def lat_lon_to_h3(coordinates: Iterable[Tuple[float, float]], resolution: int = 7) -> List[str]:
    """
    Convert a list of latitude/longitude coordinates into H3 hexagons at a specific resolution.

    Parameters:
        coordinates (list of tuple): List of (latitude, longitude) tuples.
        resolution (int): H3 resolution level. Default is 7.

    Returns:
        list of str: List of H3 hexagons corresponding to the input coordinates, in the same order.
    """
    return [h3.geo_to_h3(lat, lon, resolution) for lat, lon in coordinates]

def _to_h3_polygon(geom):
    """
    Convert a Shapely geometry (or GeoJSON-like dict) into h3.LatLngPoly
    (or LatLngMultiPoly) which is the expected input for h3.polygon_to_cells
    in this installation of the h3 package.

    Returns an instance of h3.LatLngPoly or h3.LatLngMultiPoly.
    """
    # Accept dict (GeoJSON-like) or shapely geometry
    if isinstance(geom, dict):
        geom = shape(geom)

    if isinstance(geom, Polygon):
        # shapely coords are (lon, lat) or may include Z (lon, lat, z) or nested tuples.
        def _point_to_latlon(pt):
            """Return (lat, lon) from a possibly nested point structure.

            Handles:
            - shapely Point-like objects with .x/.y
            - nested tuples/lists like ((lon, lat),) or ((lon, lat, z),)
            - flat sequences like (lon, lat) or [lon, lat, z]
            Raises ValueError when two numeric coordinates cannot be found.
            """
            # shapely Point-like
            if hasattr(pt, "x") and hasattr(pt, "y"):
                try:
                    return (float(pt.y), float(pt.x))
                except Exception as e:
                    raise ValueError(f"Invalid shapely point coordinates: {pt} ({e})")

            # Recursively flatten nested sequences and collect scalar values
            flat = []
            def _flatten(x):
                if isinstance(x, (list, tuple)):
                    for y in x:
                        _flatten(y)
                else:
                    flat.append(x)

            _flatten(pt)
            if len(flat) >= 2:
                try:
                    lon = float(flat[0])
                    lat = float(flat[1])
                    return (lat, lon)
                except Exception as e:
                    raise ValueError(f"Invalid numeric coordinate values after flattening: {flat[:4]} ({e})")

            raise ValueError(f"Could not extract two numeric coordinate values from: {pt}")

        # LatLngPoly expects (lat, lon) pairs
        exterior = [_point_to_latlon(pt) for pt in geom.exterior.coords]
        interiors = [ [_point_to_latlon(pt) for pt in interior.coords] for interior in geom.interiors ]
        if interiors:
            return h3.LatLngPoly(exterior, *interiors)
        return h3.LatLngPoly(exterior)

    if isinstance(geom, MultiPolygon):
        polys = []
        for part in geom.geoms:
            def _point_to_latlon(pt):
                if isinstance(pt, (list, tuple)) and len(pt) and isinstance(pt[0], (list, tuple)):
                    pt = pt[0]
                try:
                    lon = float(pt[0])
                    lat = float(pt[1])
                except Exception as e:
                    raise ValueError(f"Invalid coordinate point encountered: {pt} ({e})")
                return (lat, lon)

            exterior = [_point_to_latlon(pt) for pt in part.exterior.coords]
            interiors = [ [_point_to_latlon(pt) for pt in interior.coords] for interior in part.interiors ]
            if interiors:
                polys.append(h3.LatLngPoly(exterior, *interiors))
            else:
                polys.append(h3.LatLngPoly(exterior))
        return h3.LatLngMultiPoly(*polys)

    raise ValueError(f"Unsupported geometry type for conversion to H3 polygon: {type(geom)}")


def get_hexagons_within_boundary(boundary, resolution: int = 7) -> Set[str]:
    """
    Get all H3 hexagons at a specific resolution within a geographic boundary.

    Parameters:
        boundary (dict or shapely.geometry): GeoJSON-like polygon/MultiPolygon or shapely geometry.
            Coordinates are expected to be GeoJSON-style ([lon, lat]) if dict is provided; this
            function will convert them to the lat/lon order expected by the H3 functions.
        resolution (int): H3 resolution level. Default is 7.

    Returns:
        set: Set of H3 hexagons within the boundary.
    """
    # Accept GeoJSON-like dicts or shapely geometries
    if isinstance(boundary, dict):
        geom = shape(boundary)
    else:
        geom = boundary

    hexes: Set[str] = set()

    # Support Polygon and MultiPolygon by iterating through polygons
    if isinstance(geom, Polygon):
        poly = _to_h3_polygon(geom)
        # Use the documented polygon_to_cells function from h3.
        hexes.update(h3.polygon_to_cells(poly, resolution))
    elif isinstance(geom, MultiPolygon):
        for part in geom.geoms:
            poly = _to_h3_polygon(part)
            hexes.update(h3.polygon_to_cells(poly, resolution))
    else:
        raise ValueError(f"Unsupported geometry type: {type(geom)}")

    return hexes


def get_cell_centroids_for_county(county_fips: str, file_key: str = "hex_id_by_county") -> dict:
    """
    Load H3 cell ids for a given county from a JSON mapping file and return a
    dictionary mapping each H3 id to its centroid (lat, lon).

    Parameters:
        county_fips: county FIPS code (string or int-compatible).
        file_path: optional path to the `hex_id_by_county.json` file. If None,
            the function will look for `data/processed/hex_id_by_county.json`
            at the repository root.

    Returns:
        dict: {h3_id: (lat, lon), ...}

    Raises:
        FileNotFoundError: if the JSON file cannot be found.
        KeyError: if the requested county_fips is not present in the file.
    """
    import json
    from pathlib import Path

    # Try to resolve the actual file path using the project's file loader
    try:
        from src.io.file_loader import load_file_by_key
        file_path = Path(load_file_by_key(file_key))
    except Exception:
        # fallback to repo data/processed/<file_key>.json
        file_path = Path(__file__).resolve().parents[2] / "data" / "processed" / f"{file_key}.json"
        if not file_path.exists():
            raise FileNotFoundError(f"Hex ID mapping file not found for key '{file_key}'. Tried: {file_path}")

    with file_path.open("r") as f:
        data = json.load(f)

    # Normalize county_fips to string and try variants present in the file
    county_key = str(county_fips)
    if isinstance(county_fips, int):
        county_key = str(county_fips).zfill(3)

    if county_key not in data:
        alt = county_key.zfill(3)
        alt2 = str(int(county_key)) if county_key.isdigit() else county_key
        if alt in data:
            county_key = alt
        elif alt2 in data:
            county_key = alt2
        else:
            raise KeyError(f"County FIPS '{county_fips}' not found in {file_path}")

    cells = data[county_key]
    result: dict = {}
    for h in cells:
        try:
            result[h] = h3.cell_to_latlng(h)
        except Exception:
            # skip invalid h3 ids
            continue

    return result


def get_centroids_of_hexagons_within_boundary(boundary, resolution: int = 7) -> List[Tuple[float, float]]:
    """
    Convenience wrapper: return centroids (lat, lon) for all H3 cells within a boundary.
    """
    hexagons = get_hexagons_within_boundary(boundary, resolution)
    return [h3.cell_to_latlng(h) for h in hexagons]


# Example usage
if __name__ == "__main__":
    # coords = [(33.765, -117.948), (43.6667, -79.4)]
    # hexagons = lat_lon_to_h3(coords)
    # print(hexagons)

    # # Define a GeoJSON-like polygon (example: a square boundary)
    # boundary = {
    #     "type": "Polygon",
    #     "coordinates": [
    #         [
    #             [-79.5, 43.6],  # Bottom-left corner
    #             [-79.5, 43.7],  # Top-left corner
    #             [-79.3, 43.7],  # Top-right corner
    #             [-79.3, 43.6],  # Bottom-right corner
    #             [-79.5, 43.6]   # Close the polygon
    #         ]
    #     ]
    # }

    # hexagons = get_hexagons_within_boundary(boundary)
    # print(hexagons)

    centroids = get_cell_centroids_for_county("073")
    print(f"Number of H3 cells: {len(centroids)}")

