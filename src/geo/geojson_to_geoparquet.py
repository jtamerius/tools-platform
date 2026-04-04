import requests
import geopandas as gpd
from pyarrow import parquet as pq
import logging
from src.io.file_loader import load_file_by_key

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def fetch_stream(api_url):
    """
    Fetch GeoJSON data from an API and convert it directly into a GeoDataFrame.

    Parameters:
        api_url (str): The URL of the GeoJSON API.

    Returns:
        GeoDataFrame: A GeoDataFrame containing the GeoJSON data.
    """
    response = requests.get(api_url)
    response.raise_for_status()
    try:
        gdf = gpd.read_file(response.text)
        print("CRS after reading GeoJSON:", gdf.crs)  # Debugging step
        if gdf.crs is None:
            gdf = gdf.set_crs(epsg=4326)
        return gdf
    except Exception as e:
        logging.error(f"Error converting GeoJSON to GeoDataFrame: {e}")
        return gpd.GeoDataFrame(columns=['geometry'])

def geojson_to_geoparquet_pipeline(api_url, output_path):
    """
    Orchestrate the pipeline to convert GeoJSON to GeoParquet.

    Parameters:
        api_url (str): The URL of the GeoJSON API.
        output_path (str): The path to the output GeoParquet file.
    """
    try:
        gdf = fetch_stream(api_url)
        print("CRS after fetching stream:", gdf.crs)  # Check CRS after fetching
        print("Geometry sample after fetching:\n", gdf.geometry.head())  # Check geometries

        # Ensure CRS is explicitly set to EPSG:4326
        gdf = gdf.to_crs(epsg=4326)
        print("CRS after transformation to EPSG:4326:", gdf.crs)  # Check CRS after transformation

        # Save to GeoParquet
        gdf.to_parquet(output_path, engine="pyarrow", index=False)
        logging.info(f"GeoParquet file successfully written to {output_path}")

        # Reload and check the saved file
        saved_gdf = gpd.read_parquet(output_path)
        print("CRS of saved GeoParquet file:", saved_gdf.crs)  # Check CRS of saved file
        print("Geometry sample from saved file:\n", saved_gdf.geometry.head())  # Check geometries

    except Exception as e:
        logging.error(f"Pipeline error: {e}")

# Example usage
if __name__ == "__main__":
    api_url = "https://gis.data.ca.gov/api/download/v1/items/a7a5b9ebd58842e9979933cb7fe2287c/geojson?layers=0"
    output_path = load_file_by_key("ca_county_boundaries")  # Load the output path dynamically
    geojson_to_geoparquet_pipeline(api_url, output_path)