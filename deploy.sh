#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script configuration
PROJECT_NAME="ai-presentation-coach-deployer"
COMPUTE_TYPE="BUILD_GENERAL1_SMALL"
BUILD_IMAGE="aws/codebuild/amazonlinux2-aarch64-standard:3.0"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   AI Presentation Coach - GitHub Deployment Script        ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo ""

# Get AWS region from CLI config
AWS_REGION=$(aws configure get region)
if [ -z "$AWS_REGION" ]; then
    echo -e "${RED}Error: AWS region not configured. Please run 'aws configure' first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Using AWS Region: $AWS_REGION${NC}"

# Get AWS Account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)
if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo -e "${RED}Error: Unable to get AWS account ID. Please check your AWS credentials.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ AWS Account ID: $AWS_ACCOUNT_ID${NC}"
echo ""

# Prompt for GitHub repository
echo -e "${YELLOW}Enter GitHub repository (format: owner/repo):${NC}"
read -p "> " GITHUB_REPO

if [ -z "$GITHUB_REPO" ]; then
    echo -e "${RED}Error: GitHub repository is required.${NC}"
    exit 1
fi

# Validate format
if [[ ! "$GITHUB_REPO" =~ ^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+$ ]]; then
    echo -e "${RED}Error: Invalid repository format. Use: owner/repo${NC}"
    exit 1
fi

GITHUB_OWNER=$(echo "$GITHUB_REPO" | cut -d'/' -f1)
GITHUB_REPO_NAME=$(echo "$GITHUB_REPO" | cut -d'/' -f2)

echo -e "${GREEN}✓ Repository: $GITHUB_REPO${NC}"
echo ""

# Prompt for branch
echo -e "${YELLOW}Enter branch name (e.g., main, develop, feature/new-ui):${NC}"
read -p "> " BRANCH_NAME

if [ -z "$BRANCH_NAME" ]; then
    echo -e "${RED}Error: Branch name is required.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Branch: $BRANCH_NAME${NC}"
echo ""

# Sanitize branch name for stack name
# Replace / with -, remove special characters, convert to lowercase
SANITIZED_BRANCH=$(echo "$BRANCH_NAME" | sed 's/\//-/g' | sed 's/[^a-zA-Z0-9-]/-/g' | tr '[:upper:]' '[:lower:]')
STACK_NAME="AIPresentationCoachStack-${SANITIZED_BRANCH}"

echo -e "${BLUE}Stack Name: $STACK_NAME${NC}"
echo ""

# Prompt for GitHub token (optional)
echo -e "${YELLOW}Enter GitHub Personal Access Token (optional, press Enter to skip):${NC}"
echo -e "${YELLOW}Required only for private repositories${NC}"
read -s -p "> " GITHUB_TOKEN
echo ""

if [ -n "$GITHUB_TOKEN" ]; then
    echo -e "${GREEN}✓ GitHub token provided${NC}"
else
    echo -e "${BLUE}ℹ Proceeding without GitHub token (public repository)${NC}"
fi
echo ""

# Check if CodeBuild project exists
echo -e "${BLUE}Checking if CodeBuild project exists...${NC}"
PROJECT_EXISTS=$(aws codebuild batch-get-projects \
    --names "$PROJECT_NAME" \
    --region "$AWS_REGION" \
    --query 'projects[0].name' \
    --output text 2>/dev/null || echo "None")

if [ "$PROJECT_EXISTS" = "None" ] || [ "$PROJECT_EXISTS" = "" ]; then
    echo -e "${YELLOW}CodeBuild project not found. Creating new project...${NC}"
    
    # Create service role for CodeBuild
    ROLE_NAME="${PROJECT_NAME}-role"
    
    # Check if role exists
    ROLE_EXISTS=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || echo "")
    
    if [ -z "$ROLE_EXISTS" ]; then
        echo -e "${BLUE}Creating IAM role for CodeBuild...${NC}"
        
        # Create trust policy
        cat > /tmp/trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "codebuild.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
        
        # Create role
        ROLE_ARN=$(aws iam create-role \
            --role-name "$ROLE_NAME" \
            --assume-role-policy-document file:///tmp/trust-policy.json \
            --query 'Role.Arn' \
            --output text)
        
        # Attach policies
        aws iam attach-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-arn "arn:aws:iam::aws:policy/AdministratorAccess"
        
        echo -e "${GREEN}✓ IAM role created: $ROLE_ARN${NC}"
        
        # Wait for role to propagate
        echo -e "${BLUE}Waiting for IAM role to propagate...${NC}"
        sleep 10
        
        rm /tmp/trust-policy.json
    else
        ROLE_ARN="$ROLE_EXISTS"
        echo -e "${GREEN}✓ Using existing IAM role: $ROLE_ARN${NC}"
    fi
    
    # Create CodeBuild project
    aws codebuild create-project \
        --name "$PROJECT_NAME" \
        --description "Automated deployment for AI Presentation Coach from GitHub" \
        --source type=GITHUB,location="https://github.com/${GITHUB_REPO}.git" \
        --artifacts type=NO_ARTIFACTS \
        --environment type=ARM_CONTAINER,image="$BUILD_IMAGE",computeType="$COMPUTE_TYPE",privilegedMode=true \
        --service-role "$ROLE_ARN" \
        --region "$AWS_REGION" \
        > /dev/null
    
    echo -e "${GREEN}✓ CodeBuild project created: $PROJECT_NAME${NC}"
else
    echo -e "${GREEN}✓ Using existing CodeBuild project: $PROJECT_NAME${NC}"
fi
echo ""

# Prepare environment variables for the build
ENV_VARS="[{\"name\":\"BRANCH_NAME\",\"value\":\"$BRANCH_NAME\",\"type\":\"PLAINTEXT\"},{\"name\":\"STACK_NAME\",\"value\":\"$STACK_NAME\",\"type\":\"PLAINTEXT\"}"

# Add GitHub token if provided
if [ -n "$GITHUB_TOKEN" ]; then
    ENV_VARS="${ENV_VARS},{\"name\":\"GITHUB_TOKEN\",\"value\":\"$GITHUB_TOKEN\",\"type\":\"PLAINTEXT\"}"
fi

ENV_VARS="${ENV_VARS}]"

# Start the build
echo -e "${BLUE}Starting CodeBuild deployment...${NC}"
echo ""

BUILD_OUTPUT=$(aws codebuild start-build \
    --project-name "$PROJECT_NAME" \
    --source-version "$BRANCH_NAME" \
    --environment-variables-override "$ENV_VARS" \
    --region "$AWS_REGION" \
    --output json)

BUILD_ID=$(echo "$BUILD_OUTPUT" | grep -o '"id": "[^"]*"' | cut -d'"' -f4)
BUILD_ARN=$(echo "$BUILD_OUTPUT" | grep -o '"arn": "[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$BUILD_ID" ]; then
    echo -e "${RED}Error: Failed to start build${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build started successfully!${NC}"
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Build ID:${NC} $BUILD_ID"
echo -e "${GREEN}Stack Name:${NC} $STACK_NAME"
echo -e "${GREEN}Branch:${NC} $BRANCH_NAME"
echo -e "${GREEN}Repository:${NC} $GITHUB_REPO"
echo ""
echo -e "${YELLOW}Monitor your build at:${NC}"
echo -e "${BLUE}https://console.aws.amazon.com/codesuite/codebuild/${AWS_ACCOUNT_ID}/projects/${PROJECT_NAME}/build/${BUILD_ID}/?region=${AWS_REGION}${NC}"
echo ""
echo -e "${YELLOW}CloudWatch Logs:${NC}"
echo -e "${BLUE}https://console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#logsV2:log-groups/log-group/\$252Faws\$252Fcodebuild\$252F${PROJECT_NAME}${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}Deployment initiated! The script will now exit.${NC}"
echo -e "${YELLOW}The build will continue running in CodeBuild.${NC}"
