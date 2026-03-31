import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Duration } from "aws-cdk-lib";
import { withStageName } from "../helpers.js";
import type { CompilationContext, EventBinding } from "../types.js";

export function synthesizeSQS(ctx: CompilationContext): void {
  const { stack, config, refs } = ctx;

  for (const [name, queue] of Object.entries(config.messaging.sqs)) {
    refs[name] = new sqs.Queue(stack, `Queue${name}`, {
      queueName: withStageName(name, config.provider.stage),
      visibilityTimeout: queue.visibilityTimeout
        ? Duration.seconds(queue.visibilityTimeout)
        : undefined,
    });
  }
}

export function bindSQSEvents(
  ctx: CompilationContext,
  events: EventBinding[],
): void {
  const { refs } = ctx;

  for (const event of events) {
    if (event.type !== "sqs") continue;
    const refName = event.queue.replace("ref:", "");
    const queue = refs[refName];
    if (!queue || !("queueArn" in queue)) {
      throw new Error(
        `SQS event references unknown queue "${refName}". Define it under messaging.sqs.`,
      );
    }
    event.fnResource.addEventSource(
      new lambdaEventSources.SqsEventSource(queue as sqs.Queue, {
        batchSize: event.batchSize ?? 10,
      }),
    );
  }
}
