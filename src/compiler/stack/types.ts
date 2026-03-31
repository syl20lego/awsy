import type cdk from "aws-cdk-lib";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs";
import type { NormalizedServiceConfig } from "../../config/normalize.js";

export type ResourceRefs = Record<string, Construct>;

export interface CompilationContext {
  stack: cdk.Stack;
  config: NormalizedServiceConfig;
  refs: ResourceRefs;
}

// Discriminated union for all function event sources.
export type EventBinding = { functionName: string; fnResource: lambda.Function } & (
  | { type: "http"; method: string; path: string }
  | { type: "rest"; method: string; path: string; apiKeyRequired: boolean }
  | { type: "s3"; bucket: string; events: string[] }
  | { type: "sqs"; queue: string; batchSize?: number }
  | { type: "sns"; topic: string }
  | { type: "dynamodb-stream"; table: string; batchSize?: number; startingPosition?: string }
  | { type: "eventbridge"; schedule?: string; eventPattern?: Record<string, unknown> }
);

