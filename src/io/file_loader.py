import yaml
import os

def load_file_by_key(key: str) -> str:
    """
    Load a file path from the YAML configuration file based on the provided key.

    Parameters:
        key (str): The key to look up in the YAML configuration file.

    Returns:
        str: The absolute path to the file corresponding to the key.

    Raises:
        KeyError: If the key is not found in the configuration file.
        FileNotFoundError: If the configuration file does not exist.
    """
    config_path = os.path.join(os.getcwd(), "config/file_paths.yaml")

    # Check if the configuration file exists
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Configuration file not found: {config_path}")

    # Load the YAML configuration file
    with open(config_path, "r") as file:
        config = yaml.safe_load(file)

    # Retrieve the file path for the given key
    if key not in config:
        raise KeyError(f"Key '{key}' not found in configuration file.")

    # Return the absolute path to the file
    return os.path.join(os.getcwd(), config[key])
