# SageMaker Processing container for the maritime AIS pipeline.
#
# Extends the AWS-managed SageMaker scikit-learn base image with the two
# packages the base image omits: pyarrow (Parquet I/O) and zstandard
# (Zstd-compressed AIS CSV decompression).
#
# Build and push — handled automatically by infra/scripts/setup-maritime.sh.
# To build manually:
#
#   ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
#   REGION=us-east-1
#   REPO=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/tools-maritime-processing
#
#   aws ecr get-login-password --region $REGION | \
#     docker login --username AWS --password-stdin \
#     683313688378.dkr.ecr.$REGION.amazonaws.com
#
#   docker build -t $REPO:latest .
#   docker push $REPO:latest
#
# The base image tag below is pinned. When upgrading, verify the new tag
# exists in the 683313688378 account for your target region:
#   aws ecr describe-images \
#     --registry-id 683313688378 \
#     --repository-name sagemaker-scikit-learn \
#     --region us-east-1

FROM 683313688378.dkr.ecr.us-east-1.amazonaws.com/sagemaker-scikit-learn:1.2-1-cpu-py3

RUN pip install --no-cache-dir \
    pyarrow==15.0.2 \
    zstandard==0.22.0
