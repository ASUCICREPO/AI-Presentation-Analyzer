#!/bin/bash

# AI Presentation Analyzer - One-click deployment script
# This script handles building Lambda layers and deploying the CDK stack
#
# Usage: ./deploy.sh [stack-args]
# Example: ./deploy.sh --require-approval never

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
AGENTCORE_DIR="$BACKEND_DIR/agentcore"
LAYER_DIR="$AGENTCORE_DIR/python/lib/python3.12/site-packages"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}AI Presentation Analyzer Deploy${NC}"
echo -e "${GREEN}================================${NC}"
echo ""

# Step 1: Build Lambda layer dependencies
echo -e "${YELLOW}Step 1: Building Lambda layer dependencies...${NC}"
mkdir -p "$LAYER_DIR"

echo "Installing Python dependencies using AWS Lambda Docker image..."
docker run --rm \
  --platform linux/arm64 \
  --volume "$AGENTCORE_DIR/requirements.txt:/tmp/requirements.txt:ro" \
  --volume "$LAYER_DIR:/tmp/site-packages" \
  public.ecr.aws/lambda/python:3.12 \
  pip install -r /tmp/requirements.txt -t /tmp/site-packages --quiet

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Lambda layer dependencies built successfully${NC}"
else
  echo -e "${RED}✗ Failed to build Lambda layer dependencies${NC}"
  exit 1
fi
echo ""

# Step 2: Build TypeScript CDK code
echo -e "${YELLOW}Step 2: Building TypeScript CDK code...${NC}"
cd "$BACKEND_DIR"

if [ ! -d "node_modules" ]; then
  echo "Installing npm dependencies..."
  npm install --quiet
fi

echo "Compiling TypeScript..."
npm run build --quiet

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ CDK TypeScript compiled successfully${NC}"
else
  echo -e "${RED}✗ Failed to compile CDK TypeScript${NC}"
  exit 1
fi
echo ""

# Step 3: Deploy CDK stack
echo -e "${YELLOW}Step 3: Deploying AWS CDK stack...${NC}"
CDK_ARGS="${@:---require-approval never}"

npx cdk deploy $CDK_ARGS

if [ $? -eq 0 ]; then
  echo ""
  echo -e "${GREEN}================================${NC}"
  echo -e "${GREEN}✓ Deployment successful!${NC}"
  echo -e "${GREEN}================================${NC}"
else
  echo ""
  echo -e "${RED}================================${NC}"
  echo -e "${RED}✗ Deployment failed${NC}"
  echo -e "${RED}================================${NC}"
  exit 1
fi
