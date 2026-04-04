import requests
import json
from datetime import datetime
from src.aws_interface.access_aws import get_parameter_from_ssm
from src.geo.h3_helpers import get_cell_centroids_for_county
import random
from src.io.file_loader import load_file_by_key
import time
from datetime import timedelta


def map_coco_to_cloud_cover(coco) -> float | None:
    """Map Meteostat 'coco' weather codes to coarse probability values.

    Rules (coarse mapping):
      0 -> 0.05        # clear
      1 -> 0.20        # mainly clear
      2 -> 0.50        # partly cloudy
      3 -> 0.95        # overcast
      45,48 -> 0.80    # fog
      51-67 -> 0.90    # drizzle/rain
      71-77 -> 0.90    # snow
      80-82 -> 0.90    # rain showers
      85-86 -> 0.90    # snow showers
      95-99 -> 0.95    # thunder

    Returns None if mapping is not applicable.
    """
    try:
        c = int(coco)
    except Exception:
        return None

    if c == 0:
        return 0.05
    if c == 1:
        return 0.20
    if c == 2:
        return 0.50
    if c == 3:
        return 0.95
    if c in (45, 48):
        return 0.80
    if 51 <= c <= 67:
        return 0.90
    if 71 <= c <= 77:
        return 0.90
    if 80 <= c <= 82:
        return 0.90
    if 85 <= c <= 86:
        return 0.90
    if 95 <= c <= 99:
        return 0.95

    return None


def kasten_czeplak_transmittance(n: float | None) -> float | None:
    """Convert cloud fraction n (0-1) to transmittance T using Kasten–Czeplak:

    T = 1 - 0.75 * n**3.4

    - If n is None or cannot be converted to float, returns None.
    - Input is clamped to [0,1]. Output is clamped to [0,1].
    """
    if n is None:
        return None
    try:
        nn = float(n)
    except Exception:
        return None

    # Clamp input to [0,1]
    nn = max(0.0, min(1.0, nn))

    T = 1.0 - 0.75 * (nn ** 3.4)

    # Clamp output to [0,1] to avoid tiny floating point overshoot
    T = max(0.0, min(1.0, T))
    return T

def fetch_meteostat_data(lat=33.765, lon=-117.948, start_date="2025-01-01", end_date="2025-01-01", tz="America/Los_Angeles", api_key=None, endpoint="https://meteostat.p.rapidapi.com/point/hourly"):
    """
    Fetch hourly weather data from the Meteostat API for a given latitude, longitude, and date range.

    Parameters:
        lat (float): Latitude of the location. Default is 33.765.
        lon (float): Longitude of the location. Default is -117.948.
        start_date (str): Start date in YYYY-MM-DD format. Default is "2025-01-01".
        end_date (str): End date in YYYY-MM-DD format. Default is "2025-01-01".
        tz (str): Timezone for the data. Default is "America/Los_Angeles".
        api_key (str): API key for authentication. Default is None.
        endpoint (str): API endpoint URL. Default is "https://meteostat.p.rapidapi.com/point/hourly".

    Returns:
        dict: JSON response from the Meteostat API.
    """
    if not api_key:
        # Fetch the API key from AWS Parameter Store
        api_key = get_parameter_from_ssm("meteostat_api_key")

    params = {
        "lat": lat,
        "lon": lon,
        "start": start_date,
        "end": end_date,
        "tz": tz
    }

    headers = {
        "x-rapidapi-host": "meteostat.p.rapidapi.com",
        "x-rapidapi-key": api_key
    }

    try:
        response = requests.get(endpoint, headers=headers, params=params)
        try:
            response.raise_for_status()  # Raise an HTTPError for bad responses (4xx and 5xx)
        except requests.exceptions.HTTPError as http_err:
            # Print detailed response for debugging
            body = None
            try:
                body = response.text
            except Exception:
                body = '<could not read response body>'
            print(f"An HTTP error occurred: {response.status_code} {http_err}\nResponse body: {body}")
            # Return structured error info so callers can record it
            return {"error": str(http_err), "status": response.status_code, "body": body}

        # Success
        try:
            return response.json()
        except ValueError:
            # Non-JSON success response
            return {"result": response.text}
    except requests.exceptions.RequestException as e:
        print(f"An error occurred: {e}")
        return {"error": str(e)}


    """
    Fetch Meteostat point/hourly data by splitting the requested date range into
    chunks of at most `max_days` days (Meteostat limits requests). Retries
    on transient errors (5xx, timeouts) with exponential backoff.

    Returns a dict with combined 'data' list on success, or an 'error' entry
    describing failures.
    """
    start = datetime.fromisoformat(start_date).date()
    end = datetime.fromisoformat(end_date).date()
    if end < start:
        return {"error": "end_date must be on or after start_date"}

    all_data = []
    errors = []

    cur_start = start
    while cur_start <= end:
        cur_end = min(cur_start + timedelta(days=max_days - 1), end)
        s = cur_start.isoformat()
        e = cur_end.isoformat()

        attempt = 0
        while attempt <= retries:
            attempt += 1
            res = fetch_meteostat_data(lat=lat, lon=lon, start_date=s, end_date=e, tz=tz)
            # If res is an error dict, check if it's retryable (5xx or network)
            if isinstance(res, dict) and res.get("error"):
                status = res.get("status")
                # Retry on server errors (5xx) or no status (network)
                if status is None or (isinstance(status, int) and 500 <= status < 600):
                    if attempt <= retries:
                        sleep_for = backoff_factor ** attempt
                        time.sleep(sleep_for)
                        continue
                # Not retryable or out of attempts: record error and break
                errors.append({"start": s, "end": e, "error": res})
                break
            else:
                # success: append data list if present, else append full response
                if isinstance(res, dict) and "data" in res and isinstance(res["data"], list):
                    all_data.extend(res["data"])
                else:
                    # unknown structure -> keep as-is under a wrapper
                    all_data.append(res)
                break

        cur_start = cur_end + timedelta(days=1)

    if errors and not all_data:
        # All chunks failed
        return {"error": "all_chunks_failed", "details": errors}

    result = {"data": all_data}
    if errors:
        result["partial_errors"] = errors
    return result

def sample_county_weather_data(county_fips='073', n_samples=2, start_date="2024-01-01", end_date="2024-12-31", output_file=None):
    """
    Get hex IDs for a county, sample n locations, fetch weather data, and save to JSON file.
    
    Parameters:
        county_fips (str): County FIPS code (e.g., "073")
        n_samples (int): Number of locations to sample. Default is 10.
        start_date (str): Start date in YYYY-MM-DD format. Default is "2025-01-01".
        end_date (str): End date in YYYY-MM-DD format. Default is "2025-01-01".
        output_file (str): Output file path. If None, uses county_fips_weather_data.json
    
    Returns:
        dict: Combined weather data for all sampled locations
    """
    
    # Get centroids for the county
    centroids = get_cell_centroids_for_county(county_fips)
    
    if not centroids:
        print(f"No centroids found for county FIPS: {county_fips}")
        return None
    
    # Sample n locations
    sample_size = min(n_samples, len(centroids))
    sampled_centroids = random.sample(list(centroids.items()), sample_size)
    
    # Collect weather data for each sampled location
    weather_data = {
        "county_fips": county_fips,
        "date_range": f"{start_date} to {end_date}",
        "locations": []
    }
    
    for hex_id, (lat, lon) in sampled_centroids:
        print(f"Fetching weather data for hex_id: {hex_id} at ({lat}, {lon})")

        location_data = fetch_meteostat_data(
            lat=lat,
            lon=lon,
            start_date=start_date,
            end_date=end_date
        )

        # Record either the fetched data or the error returned by the fetch function
        is_error = isinstance(location_data, dict) and location_data.get("error")
        if location_data and not is_error:
            # If the API returned hourly 'data', map coco -> probability for each record
            if isinstance(location_data, dict) and "data" in location_data and isinstance(location_data["data"], list):
                for rec in location_data["data"]:
                    if "coco" in rec:
                        prob = map_coco_to_cloud_cover(rec.get("coco"))
                        # store mapped probability as coco_prob, keep original coco
                        rec["coco_prob"] = prob
                        # compute transmittance from cloud fraction/probability using Kasten–Czeplak
                        trans = kasten_czeplak_transmittance(prob)
                        rec["coco_transmittance"] = trans
                        # estimate GHI (W/m^2) by scaling transmittance (approx): GHI ≈ transmittance * 800
                        rec["ghi_estimate"] = (trans * 800) if (trans is not None) else None

            weather_data["locations"].append({
                "hex_id": hex_id,
                "latitude": lat,
                "longitude": lon,
                "weather_data": location_data
            })
        else:
            # location_data is None or contains an error dict
            weather_data["locations"].append({
                "hex_id": hex_id,
                "latitude": lat,
                "longitude": lon,
                "error": location_data
            })
    
    # Save to file (resolve path from config using file key 'weather_data')
    if not output_file:
        output_file = load_file_by_key("weather_data")
    
    try:
        with open(output_file, 'w') as f:
            json.dump(weather_data, f, indent=4)
        print(f"Weather data saved to: {output_file}")
    except Exception as e:
        print(f"Error saving file: {e}")
    
    return weather_data

# Example usage
if __name__ == "__main__":

    sample_county_weather_data(county_fips="073", n_samples=2, start_date="2024-01-01", end_date="2024-01-15")
