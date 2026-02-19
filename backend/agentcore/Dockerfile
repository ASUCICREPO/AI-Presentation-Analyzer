    FROM public.ecr.aws/lambda/python:3.12

    # Set environment variables
    ENV PYTHONDONTWRITEBYTECODE=1 \
        PYTHONUNBUFFERED=1

    # Set work directory
    WORKDIR /app

    ENV DOCKER_CONTAINER=1

    # Install system dependencies (if needed)
    RUN apt-get update \
        && apt-get install -y --no-install-recommends \
            build-essential \
            gcc \
            libffi-dev \
            libssl-dev \
            git \
        && rm -rf /var/lib/apt/lists/*

    #Create a service account non-root user
    RUN useradd -m -u 1000 bedrock_agentcore
    USER bedrock_agentcore

    # Install Python dependencies
    COPY requirements.txt ./
    RUN pip install --upgrade pip \
        && pip install --no-cache-dir -r requirements.txt
    RUN pip install aws-opentelemetry-distro>=0.10.1

    # Copy project files
    COPY . .

    # Set default entrypoint
    CMD ["opentelemetry-instrument", "python", "index.py"]
