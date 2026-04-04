from src.geo.geojson_to_geoparquet import geojson_to_geoparquet_pipeline
import json
from src.geo.geo_helpers import query_geoparquet_by_columns
from src.geo.h3_helpers import get_cell_centroids_for_county, get_hexagons_within_boundary
from src.io.file_loader import load_file_by_key

def loadcounty_boundaries():
    """
    Generate all foundational datasets required for the project.
    """
    # California County Boundaries
    api_url = "https://gis.data.ca.gov/api/download/v1/items/a7a5b9ebd58842e9979933cb7fe2287c/geojson?layers=0"
    output_path = "/Users/James/Documents/Projects/portfolio/data/processed/ca_county_boundaries.parquet"
    geojson_to_geoparquet_pipeline(api_url, output_path)

def generate_hex_ids_by_county(resolution=7):
    """
    Generate a JSON file mapping each county in California to its H3 hex IDs at a specified resolution.

    Parameters:
        resolution (int): H3 resolution level. Default is 7.

    Returns:
        None
    """
    # Load the GeoParquet file path
    file_path = load_file_by_key("ca_county_boundaries")

    # Load the output path from the YAML configuration
    output_path = load_file_by_key("hex_id_by_county")

    # Load the GeoParquet file
    gdf = query_geoparquet_by_columns(file_path, {})  # Load all counties

    # Initialize the result dictionary
    hex_id_by_county = {}

    for _, row in gdf.iterrows():
        try:
            county_fips = str(row.get("COUNTY_FIPS", "unknown"))
            # Pass the shapely geometry object directly to the helper. Constructing a
            # GeoJSON dict from __geo_interface__ can produce nested coordinate
            # tuple structures that cause numeric conversion errors downstream.
            geom = row["geometry"]
            hexagons = get_hexagons_within_boundary(geom, resolution)
            hex_id_by_county[county_fips] = list(hexagons)
        except Exception as e:
            # Skip invalid geometries
            geom_type = type(row.get("geometry", None))
            print(f"Skipping invalid geometry for COUNTY_FIPS {row.get('COUNTY_FIPS')} (geom type {geom_type}): {e}")

    # Save the result to a JSON file
    with open(output_path, "w") as json_file:
        json.dump(hex_id_by_county, json_file, indent=4)

def save_cell_centroids_for_county(county_fips="073", file_key="hex_centroids_by_county"):
    """
    Save get_cell_centroids_for_county.
    """
    centroids = get_cell_centroids_for_county(county_fips)



# Example usage
if __name__ == "__main__":
    # loadcounty_boundaries()
    generate_hex_ids_by_county()