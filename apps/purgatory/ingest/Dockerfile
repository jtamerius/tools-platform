FROM public.ecr.aws/lambda/python:3.12

RUN dnf install -y mesa-libGL libglvnd-glx && dnf clean all

COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt --target ${LAMBDA_TASK_ROOT}

COPY src/ ${LAMBDA_TASK_ROOT}/src/
COPY yolov8n.pt ${LAMBDA_TASK_ROOT}/yolov8n.pt

ENV YOLO_CONFIG_DIR=/tmp
ENV PYTHONPATH=${LAMBDA_TASK_ROOT}

CMD ["src.handler.handler"]
