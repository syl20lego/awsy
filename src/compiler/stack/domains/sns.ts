import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { withStageName } from "../helpers.js";
import type { CompilationContext, EventBinding } from "../types.js";

export function synthesizeSNS(ctx: CompilationContext): void {
  const { stack, config, refs } = ctx;

  for (const [name, topic] of Object.entries(config.messaging.sns)) {
    const topicResource = new sns.Topic(stack, `Topic${name}`, {
      topicName: withStageName(name, config.provider.stage),
    });
    refs[name] = topicResource;
    for (const subscription of topic.subscriptions ?? []) {
      if (subscription.type === "sqs") {
        const queueRef = refs[subscription.target];
        if (!queueRef || !("queueArn" in queueRef)) {
          throw new Error(
            `SNS subscription target "${subscription.target}" is not an SQS queue`,
          );
        }
      }
    }
  }
}

export function bindSNSEvents(
  ctx: CompilationContext,
  events: EventBinding[],
): void {
  const { refs } = ctx;

  for (const event of events) {
    if (event.type !== "sns") continue;
    const refName = event.topic.replace("ref:", "");
    const topic = refs[refName];
    if (!topic || !("topicArn" in topic)) {
      throw new Error(
        `SNS event references unknown topic "${refName}". Define it under messaging.sns.`,
      );
    }
    (topic as sns.Topic).addSubscription(
      new snsSubscriptions.LambdaSubscription(event.fnResource),
    );
  }
}
