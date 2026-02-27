FROM public.ecr.aws/docker/library/python:3.12-slim
WORKDIR /app

# portaudio19-dev is required by pyaudio, which strands.experimental.bidi
# imports unconditionally at module level even in server (non-audio) contexts
RUN apt-get update && apt-get install -y --no-install-recommends \
    portaudio19-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements.txt
RUN pip install -r requirements.txt

RUN pip install "aws-opentelemetry-distro>=0.10.1"

# Signal that this is running in Docker for host binding logic
ENV DOCKER_CONTAINER=1
# Disable Python output buffering so logs appear immediately in CloudWatch
ENV PYTHONUNBUFFERED=1

# All AWS environment variables (AWS_REGION, KNOWLEDGE_BASE_ID, etc.) 
# will be provided by AgentCore at runtime

# Create non-root user
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080
EXPOSE 8000

# Copy entire project (respecting .dockerignore)
COPY . .

# Use the full module path

CMD ["opentelemetry-instrument", "python", "index.py"]