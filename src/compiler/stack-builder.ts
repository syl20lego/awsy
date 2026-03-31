import cdk from "aws-cdk-lib";
import { Stack, type StackProps, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import type { NormalizedServiceConfig } from "../config/normalize.js";
import { synthesizeS3, bindS3Events } from "./stack/domains/s3.js";
import { synthesizeDynamoDB, bindDynamoDBStreamEvents } from "./stack/domains/dynamodb.js";
import { synthesizeSQS, bindSQSEvents } from "./stack/domains/sqs.js";
import { synthesizeSNS, bindSNSEvents } from "./stack/domains/sns.js";
import { bindEventBridgeEvents } from "./stack/domains/eventbridge.js";
import { synthesizeApis } from "./stack/domains/apis.js";
import { synthesizeFunctions } from "./stack/domains/functions.js";
import { createStackSynthesizer } from "./synthesizer.js";
import { validateCrossDomainConfig, validateDeploymentMode } from "./stack/validation.js";

export class ServiceStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    readonly config: NormalizedServiceConfig,
    props?: StackProps,
  ) {
    super(scope, id, props);

    Tags.of(this).add("Service", config.service);
    Tags.of(this).add("Stage", config.provider.stage);
    Object.entries(config.provider.tags ?? {}).forEach(([k, v]) => {
      Tags.of(this).add(k, v);
    });

    validateCrossDomainConfig(config);
    const refs: Record<string, Construct> = {};
    const ctx = { stack: this, config, refs };

    // Phase 1: Create infrastructure resources
    synthesizeS3(ctx);
    synthesizeDynamoDB(ctx);
    synthesizeSQS(ctx);
    synthesizeSNS(ctx);

    // Phase 2: Create functions and collect event declarations
    const { events } = synthesizeFunctions(ctx);

    // Phase 3: Bind events to resources (each domain filters its own types)
    bindS3Events(ctx, events);
    bindDynamoDBStreamEvents(ctx, events);
    bindSQSEvents(ctx, events);
    bindSNSEvents(ctx, events);
    bindEventBridgeEvents(ctx, events);
    synthesizeApis(ctx, events);
  }
}

export function buildApp(
  config: NormalizedServiceConfig,
  options?: { outdir?: string },
): { app: cdk.App; stack: ServiceStack } {
  validateDeploymentMode(config);
  const app = new cdk.App({ outdir: options?.outdir });
  const synthesizer = createStackSynthesizer(config);
  const stack = new ServiceStack(
    app,
    config.stackName,
    config,
    {
      env: {
        account: config.provider.account,
        region: config.provider.region,
      },
      synthesizer,
    },
  );
  return { app, stack };
}
