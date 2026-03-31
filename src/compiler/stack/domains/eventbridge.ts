import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { withStageName } from "../helpers.js";
import type { CompilationContext, EventBinding } from "../types.js";

export function bindEventBridgeEvents(
  ctx: CompilationContext,
  allEvents: EventBinding[],
): void {
  const { stack, config } = ctx;
  let ruleIndex = 0;

  for (const event of allEvents) {
    if (event.type !== "eventbridge") continue;
    ruleIndex++;
    const ruleName = withStageName(
      `${event.functionName}-rule-${ruleIndex}`,
      config.provider.stage,
    );

    const ruleProps: events.RuleProps = {
      ruleName,
      targets: [new targets.LambdaFunction(event.fnResource)],
    };

    if ("schedule" in event && event.schedule) {
      new events.Rule(stack, `EventBridgeRule${event.functionName}${ruleIndex}`, {
        ...ruleProps,
        schedule: events.Schedule.expression(event.schedule),
      });
    } else if ("eventPattern" in event && event.eventPattern) {
      new events.Rule(stack, `EventBridgeRule${event.functionName}${ruleIndex}`, {
        ...ruleProps,
        eventPattern: event.eventPattern as events.EventPattern,
      });
    }
  }
}
