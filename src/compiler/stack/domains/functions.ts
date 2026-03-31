import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Duration } from "aws-cdk-lib";
import { prepareFunctionBuilds } from "../../../runtime/build.js";
import { isIamRoleArn, resolveIamPolicy, withStageName } from "../helpers.js";
import type { CompilationContext, EventBinding } from "../types.js";

export interface FunctionSynthesisResult {
  events: EventBinding[];
}

export function synthesizeFunctions(
  ctx: CompilationContext,
): FunctionSynthesisResult {
  const { stack, config, refs } = ctx;
  const buildOutputs = prepareFunctionBuilds(config);
  const globalRestApiKeyRequired = config.provider.restApi?.apiKeyRequired;
  const events: EventBinding[] = [];

  for (const [name, fn] of Object.entries(config.functions)) {
    const iamEntries = fn.iam ?? [];
    const roleArnEntry = iamEntries.find((entry) => isIamRoleArn(entry));
    const inlineStatementRefs = iamEntries.filter((entry) => !isIamRoleArn(entry));
    if (roleArnEntry && inlineStatementRefs.length > 0) {
      throw new Error(
        `Function "${name}" mixes a role ARN with iam statement references. Use either a role ARN or iam.statements keys, not both.`,
      );
    }
    const importedRole = roleArnEntry
      ? iam.Role.fromRoleArn(stack, `FunctionRole${name}`, roleArnEntry, {
          mutable: false,
        })
      : undefined;

    const build = buildOutputs[name];
    const fnResource = new lambda.Function(stack, `Function${name}`, {
      functionName: withStageName(name, config.provider.stage),
      runtime:
        fn.runtime === "nodejs22.x"
          ? lambda.Runtime.NODEJS_22_X
          : lambda.Runtime.NODEJS_20_X,
      handler: build.handler,
      code: lambda.Code.fromAsset(build.assetPath),
      timeout: Duration.seconds(fn.timeout ?? 30),
      memorySize: fn.memorySize ?? 256,
      environment: fn.environment,
      role: importedRole,
    });
    refs[name] = fnResource;

    for (const policyName of inlineStatementRefs) {
      const statement = config.iam.statements[policyName];
      if (!statement) {
        throw new Error(
          `Function "${name}" references unknown IAM statement "${policyName}". Use a defined iam.statements key or a role ARN (arn:aws:iam::<account>:role/<name>).`,
        );
      }
      fnResource.addToRolePolicy(resolveIamPolicy(statement, refs));
    }

    for (const route of fn.events?.http ?? []) {
      events.push({
        functionName: name,
        fnResource,
        type: "http",
        method: route.method,
        path: route.path,
      });
    }

    const functionRestApiKeyRequired =
      globalRestApiKeyRequired ?? fn.restApi?.apiKeyRequired ?? false;
    for (const route of fn.events?.rest ?? []) {
      events.push({
        functionName: name,
        fnResource,
        type: "rest",
        method: route.method,
        path: route.path,
        apiKeyRequired: functionRestApiKeyRequired,
      });
    }

    for (const s3Event of fn.events?.s3 ?? []) {
      events.push({
        functionName: name,
        fnResource,
        type: "s3",
        bucket: s3Event.bucket,
        events: s3Event.events,
      });
    }

    for (const sqsEvent of fn.events?.sqs ?? []) {
      events.push({
        functionName: name,
        fnResource,
        type: "sqs",
        queue: sqsEvent.queue,
        batchSize: sqsEvent.batchSize,
      });
    }

    for (const snsEvent of fn.events?.sns ?? []) {
      events.push({
        functionName: name,
        fnResource,
        type: "sns",
        topic: snsEvent.topic,
      });
    }

    for (const dynamoEvent of fn.events?.dynamodb ?? []) {
      events.push({
        functionName: name,
        fnResource,
        type: "dynamodb-stream",
        table: dynamoEvent.table,
        batchSize: dynamoEvent.batchSize,
        startingPosition: dynamoEvent.startingPosition,
      });
    }

    for (const ebEvent of fn.events?.eventbridge ?? []) {
      events.push({
        functionName: name,
        fnResource,
        type: "eventbridge",
        schedule: "schedule" in ebEvent ? ebEvent.schedule : undefined,
        eventPattern:
          "eventPattern" in ebEvent
            ? (ebEvent.eventPattern as Record<string, unknown>)
            : undefined,
      });
    }
  }

  return { events };
}

