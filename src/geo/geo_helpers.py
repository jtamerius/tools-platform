import geopandas as gpd
import os
from src.io.file_loader import load_file_by_key

def query_geoparquet_by_columns(file_path: str, query: dict) -> gpd.GeoDataFrame:
    """
    Query a GeoParquet file by column values and return the result as a GeoDataFrame.

    Parameters:
        file_path (str): Path to the GeoParquet file.
        query (dict): A dictionary where keys are column names and values are the values to filter by.

    Returns:
        gpd.GeoDataFrame: A GeoDataFrame containing the filtered results.
    """
    # Load the GeoParquet file
    gdf = gpd.read_parquet(file_path)

    # Apply the query filters
    for column, value in query.items():
        gdf = gdf[gdf[column] == value]

    return gdf

# Example usage
if __name__ == "__main__":
    # Load the file path using the key from the YAML configuration
    file_path = load_file_by_key("ca_county_boundaries")
    query = {"COUNTY_FIPS": "073"}  # Example query for COUNTY_FIPS with value 073

    # Query the GeoParquet file
    result_gdf = query_geoparquet_by_columns(file_path, query)

    # Print the result
    print(result_gdf)