#!/bin/bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   AI Presentation Coach - GitHub Deployment Script        ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo ""

# Unique project name per run
PROJECT_NAME="ai-presentation-coach-$(date +%Y%m%d%H%M%S)"

# --------------------------------------------------
# 1. AWS Region & Account
# --------------------------------------------------
AWS_REGION=$(aws configure get region 2>/dev/null || echo "${AWS_DEFAULT_REGION:-}")
if [ -z "$AWS_REGION" ]; then
    AWS_REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null || echo "")
fi
if [ -z "$AWS_REGION" ]; then
    echo -e "${RED}Error: AWS region not configured. Please run 'aws configure' first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Using AWS Region: $AWS_REGION${NC}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)
if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo -e "${RED}Error: Unable to get AWS account ID. Please check your AWS credentials.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ AWS Account ID: $AWS_ACCOUNT_ID${NC}"
echo ""

# --------------------------------------------------
# 2. GitHub repository (accepts URL or owner/repo)
# --------------------------------------------------

# Try to auto-detect from git remote
DETECTED_URL=$(git remote get-url origin 2>/dev/null || echo "")

parse_github_url() {
    local input="$1"
    input="${input%.git}"
    input="${input%/}"

    if [[ "$input" =~ ^https?://github\.com/([^/]+)/([^/]+) ]]; then
        GITHUB_OWNER="${BASH_REMATCH[1]}"
        GITHUB_REPO_NAME="${BASH_REMATCH[2]}"
    elif [[ "$input" =~ ^git@github\.com:([^/]+)/([^/]+) ]]; then
        GITHUB_OWNER="${BASH_REMATCH[1]}"
        GITHUB_REPO_NAME="${BASH_REMATCH[2]}"
    elif [[ "$input" =~ ^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+$ ]]; then
        GITHUB_OWNER="${input%%/*}"
        GITHUB_REPO_NAME="${input#*/}"
    else
        return 1
    fi
}

if [ -n "$DETECTED_URL" ] && parse_github_url "$DETECTED_URL"; then
    echo -e "${GREEN}Detected repository: ${GITHUB_OWNER}/${GITHUB_REPO_NAME}${NC}"
    read -rp "Is this correct? (Y/n): " CONFIRM
    CONFIRM=$(printf '%s' "${CONFIRM:-y}" | tr '[:upper:]' '[:lower:]')

    if [[ "$CONFIRM" != "y" && "$CONFIRM" != "yes" ]]; then
        echo -e "${YELLOW}Enter GitHub repository (URL or owner/repo):${NC}"
        read -rp "> " GITHUB_INPUT
        if ! parse_github_url "$GITHUB_INPUT"; then
            echo -e "${RED}Error: Could not parse repository from '$GITHUB_INPUT'.${NC}"
            exit 1
        fi
    fi
else
    echo -e "${YELLOW}Could not detect repository from git remote.${NC}"
    echo -e "${YELLOW}Enter GitHub repository (URL or owner/repo):${NC}"
    echo -e "${YELLOW}  Examples: https://github.com/owner/repo.git  |  git@github.com:owner/repo.git  |  owner/repo${NC}"
    read -rp "> " GITHUB_INPUT

    if [ -z "$GITHUB_INPUT" ]; then
        echo -e "${RED}Error: GitHub repository is required.${NC}"
        exit 1
    fi

    if ! parse_github_url "$GITHUB_INPUT"; then
        echo -e "${RED}Error: Could not parse repository from '$GITHUB_INPUT'.${NC}"
        echo -e "${YELLOW}Accepted formats: https://github.com/owner/repo  |  git@github.com:owner/repo  |  owner/repo${NC}"
        exit 1
    fi
fi

GITHUB_REPO="${GITHUB_OWNER}/${GITHUB_REPO_NAME}"
GITHUB_URL="https://github.com/${GITHUB_REPO}"
echo -e "${GREEN}✓ Owner: $GITHUB_OWNER${NC}"
echo -e "${GREEN}✓ Repo:  $GITHUB_REPO_NAME${NC}"
echo ""

# --------------------------------------------------
# 3. Branch
# --------------------------------------------------
DETECTED_BRANCH=$(git branch --show-current 2>/dev/null || echo "")

if [ -n "$DETECTED_BRANCH" ]; then
    echo -e "${GREEN}Detected branch: ${DETECTED_BRANCH}${NC}"
    read -rp "Is this correct? (Y/n): " CONFIRM
    CONFIRM=$(printf '%s' "${CONFIRM:-y}" | tr '[:upper:]' '[:lower:]')

    if [[ "$CONFIRM" == "y" || "$CONFIRM" == "yes" ]]; then
        BRANCH_NAME="$DETECTED_BRANCH"
    else
        echo -e "${YELLOW}Enter branch name:${NC}"
        read -rp "> " BRANCH_NAME
    fi
else
    echo -e "${YELLOW}Enter branch name (e.g., main, develop, feature/new-ui):${NC}"
    read -rp "> " BRANCH_NAME
fi

if [ -z "$BRANCH_NAME" ]; then
    echo -e "${RED}Error: Branch name is required.${NC}"
    exit 1
fi

SANITIZED_BRANCH=$(echo "$BRANCH_NAME" | sed 's/\//-/g' | sed 's/[^a-zA-Z0-9-]/-/g' | tr '[:upper:]' '[:lower:]')
STACK_NAME="AIPresentationCoachStack-${SANITIZED_BRANCH}"

echo -e "${GREEN}✓ Branch: $BRANCH_NAME${NC}"
echo -e "${BLUE}Stack Name: $STACK_NAME${NC}"
echo ""

# --------------------------------------------------
# 4. GitHub token (optional — needed for private repos)
# --------------------------------------------------
echo -e "${YELLOW}Enter GitHub Personal Access Token (optional, press Enter to skip):${NC}"
echo -e "${YELLOW}Required only for private repositories${NC}"
read -rs -p "> " GITHUB_TOKEN
echo ""

if [ -n "$GITHUB_TOKEN" ]; then
    echo -e "${GREEN}✓ GitHub token provided${NC}"
else
    echo -e "${BLUE}ℹ Proceeding without GitHub token (public repository)${NC}"
fi
echo ""

# --------------------------------------------------
# 5. IAM service role
# --------------------------------------------------
ROLE_NAME="${PROJECT_NAME}-role"
echo -e "${BLUE}Checking for IAM role: $ROLE_NAME${NC}"

ROLE_EXISTS=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || echo "")

if [ -n "$ROLE_EXISTS" ]; then
    ROLE_ARN="$ROLE_EXISTS"
    echo -e "${GREEN}✓ IAM role exists: $ROLE_ARN${NC}"
else
    echo -e "${BLUE}Creating IAM role for CodeBuild...${NC}"

    TRUST_DOC='{
      "Version":"2012-10-17",
      "Statement":[{
        "Effect":"Allow",
        "Principal":{"Service":"codebuild.amazonaws.com"},
        "Action":"sts:AssumeRole"
      }]
    }'

    ROLE_ARN=$(aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document "$TRUST_DOC" \
        --query 'Role.Arn' --output text)

    aws iam attach-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-arn "arn:aws:iam::aws:policy/AdministratorAccess"

    echo -e "${GREEN}✓ IAM role created: $ROLE_ARN${NC}"
    echo -e "${BLUE}Waiting for IAM role to propagate...${NC}"
    sleep 10
fi
echo ""

# --------------------------------------------------
# 6. Import GitHub credentials (if token provided)
# --------------------------------------------------
if [ -n "$GITHUB_TOKEN" ]; then
    echo -e "${BLUE}Configuring GitHub authentication...${NC}"
    aws codebuild import-source-credentials \
        --server-type GITHUB \
        --auth-type PERSONAL_ACCESS_TOKEN \
        --token "$GITHUB_TOKEN" \
        --should-overwrite \
        --region "$AWS_REGION" \
        --query 'arn' \
        --output text > /dev/null
    echo -e "${GREEN}✓ GitHub credentials imported${NC}"
    echo ""
fi

# --------------------------------------------------
# 7. Create CodeBuild project (always fresh)
# --------------------------------------------------
echo -e "${BLUE}Creating CodeBuild project: $PROJECT_NAME${NC}"

ENVIRONMENT='{
  "type": "ARM_CONTAINER",
  "image": "aws/codebuild/amazonlinux-aarch64-standard:3.0",
  "computeType": "BUILD_GENERAL1_LARGE",
  "privilegedMode": true,
  "environmentVariables": [
    {"name":"BRANCH_NAME",   "value":"'"$BRANCH_NAME"'",    "type":"PLAINTEXT"},
    {"name":"STACK_NAME",    "value":"'"$STACK_NAME"'",     "type":"PLAINTEXT"},
    {"name":"GITHUB_TOKEN",  "value":"'"$GITHUB_TOKEN"'",   "type":"PLAINTEXT"},
    {"name":"GITHUB_OWNER",  "value":"'"$GITHUB_OWNER"'",   "type":"PLAINTEXT"},
    {"name":"GITHUB_REPO",   "value":"'"$GITHUB_REPO_NAME"'","type":"PLAINTEXT"}
  ]
}'

SOURCE='{"type":"GITHUB","location":"'"${GITHUB_URL}.git"'","buildspec":"buildspec-deploy.yml"}'
ARTIFACTS='{"type":"NO_ARTIFACTS"}'

aws codebuild create-project \
    --name "$PROJECT_NAME" \
    --description "AI Presentation Coach deploy – $GITHUB_REPO @ $BRANCH_NAME" \
    --source "$SOURCE" \
    --artifacts "$ARTIFACTS" \
    --environment "$ENVIRONMENT" \
    --service-role "$ROLE_ARN" \
    --timeout-in-minutes 60 \
    --logs-config 'cloudWatchLogs={status=ENABLED}' \
    --region "$AWS_REGION" \
    --no-cli-pager \
    > /dev/null

echo -e "${GREEN}✓ CodeBuild project created: $PROJECT_NAME${NC}"
echo ""

# --------------------------------------------------
# 8. Start the build
# --------------------------------------------------
echo -e "${BLUE}Starting CodeBuild deployment...${NC}"

BUILD_OUTPUT=$(aws codebuild start-build \
    --project-name "$PROJECT_NAME" \
    --source-version "$BRANCH_NAME" \
    --region "$AWS_REGION" \
    --no-cli-pager \
    --output json)

BUILD_ID=$(echo "$BUILD_OUTPUT" | grep -o '"id": "[^"]*"' | cut -d'"' -f4)

if [ -z "$BUILD_ID" ]; then
    echo -e "${RED}Error: Failed to start build${NC}"
    echo -e "${YELLOW}Possible causes:${NC}"
    echo -e "${YELLOW}  - Verify IAM permissions for the service role${NC}"
    echo -e "${YELLOW}  - Ensure GitHub repository is accessible${NC}"
    echo -e "${YELLOW}  - Check buildspec-deploy.yml syntax${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build started successfully!${NC}"
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Build ID:${NC}    $BUILD_ID"
echo -e "${GREEN}Project:${NC}     $PROJECT_NAME"
echo -e "${GREEN}Stack Name:${NC}  $STACK_NAME"
echo -e "${GREEN}Branch:${NC}      $BRANCH_NAME"
echo -e "${GREEN}Repository:${NC}  $GITHUB_REPO"
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
