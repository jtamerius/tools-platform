from .fetcher import fetch_forecast, fetch_forecast_grid, fetch_model_grid

# cache module is optional — not included in the Lambda deployment package
try:
    from .cache import fetch_with_cache, load_from_s3
except ImportError:
    pass

__all__ = ["fetch_forecast", "fetch_forecast_grid", "fetch_with_cache", "load_from_s3"]
