import boto3
from botocore.exceptions import BotoCoreError, ClientError

# function that creates secrets in secret manager
def create_secret(secret_name, secret_value, region_name='us-east-1'):
    client = boto3.client('secretsmanager', region_name=region_name)
    try:
        response = client.create_secret(
            Name=secret_name,
            SecretString=secret_value
        )
        return response
    except client.exceptions.ResourceExistsException:
        print(f"Secret {secret_name} already exists.")
        return None

def get_parameter_from_ssm(parameter_name, with_decryption=True):
    """
    Fetch a parameter value from AWS Systems Manager Parameter Store.

    Parameters:
        parameter_name (str): The name of the parameter to fetch.
        with_decryption (bool): Whether to decrypt the parameter if it is encrypted. Default is True.

    Returns:
        str: The value of the parameter.

    Raises:
        Exception: If there is an error fetching the parameter.
    """
    ssm_client = boto3.client('ssm')

    try:
        response = ssm_client.get_parameter(Name=parameter_name, WithDecryption=with_decryption)
        return response['Parameter']['Value']
    except (BotoCoreError, ClientError) as error:
        print(f"An error occurred while fetching the parameter: {error}")
        raise

# Example usage
if __name__ == "__main__":
    parameter_name = "your-parameter-name"
    try:
        parameter_value = get_parameter_from_ssm(parameter_name)
        print(f"Parameter Value: {parameter_value}")
    except Exception as e:
        print(f"Failed to fetch parameter: {e}")
