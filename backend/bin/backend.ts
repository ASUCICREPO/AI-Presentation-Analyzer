#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { AIPresentationCoachStack, AIPresentationCoachStackProps } from '../lib/backend-stack';

const app = new cdk.App();
const stackProps: AIPresentationCoachStackProps = {
  resourceSuffix: "qa-test"
};
new AIPresentationCoachStack(app, 'AIPresentationCoachStack-QA-Test', stackProps);

// Security scanning — validate CDK code against AWS best practices
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));