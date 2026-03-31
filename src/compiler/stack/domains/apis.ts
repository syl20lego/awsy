import cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { withStageName } from "../helpers.js";
import type { CompilationContext, EventBinding } from "../types.js";

export function synthesizeApis(
  ctx: CompilationContext,
  events: EventBinding[],
): void {
  const { stack, config } = ctx;

  const httpEvents = events.filter((e) => e.type === "http");
  const restEvents = events.filter((e) => e.type === "rest");

  // Create HTTP API (v2) if needed
  const httpApi =
    httpEvents.length > 0
      ? new apigwv2.HttpApi(stack, "HttpApi", {
          apiName: withStageName(config.service, config.provider.stage),
        })
      : undefined;

  // Create REST API (v1) if needed
  const providedRestApiCloudWatchRoleArn =
    config.provider.restApi?.cloudWatchRoleArn;
  const restApi =
    restEvents.length > 0
      ? new apigw.RestApi(stack, "RestApi", {
          restApiName: withStageName(
            `${config.service}-rest`,
            config.provider.stage,
          ),
          deployOptions: { stageName: config.provider.stage },
          cloudWatchRole: providedRestApiCloudWatchRoleArn ? false : undefined,
        })
      : undefined;

  if (restApi && providedRestApiCloudWatchRoleArn) {
    new apigw.CfnAccount(stack, "RestApiCloudWatchAccount", {
      cloudWatchRoleArn: providedRestApiCloudWatchRoleArn,
    });
  }

  // Bind HTTP routes
  for (const event of httpEvents) {
    if (event.type !== "http" || !httpApi) continue;
    httpApi.addRoutes({
      path: event.path,
      methods: [event.method.toUpperCase() as apigwv2.HttpMethod],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        `${event.functionName}-${event.method}-${event.path}`,
        event.fnResource,
      ),
    });
  }

  // Bind REST routes
  let hasAnyApiKeyRequired = false;
  for (const event of restEvents) {
    if (event.type !== "rest" || !restApi) continue;
    const resource = restApi.root.resourceForPath(event.path);
    resource.addMethod(
      event.method.toUpperCase(),
      new apigw.LambdaIntegration(event.fnResource, { proxy: true }),
      { apiKeyRequired: event.apiKeyRequired },
    );
    if (event.apiKeyRequired) hasAnyApiKeyRequired = true;
  }

  // Configure API key / usage plan if any REST route requires it
  if (restApi && hasAnyApiKeyRequired) {
    const apiKey = restApi.addApiKey("RestApiKey");
    const usagePlan = restApi.addUsagePlan("RestApiUsagePlan", {
      name: withStageName(
        `${config.service}-rest-plan`,
        config.provider.stage,
      ),
    });
    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({ stage: restApi.deploymentStage });
  }

  // Outputs
  if (httpApi) {
    new cdk.CfnOutput(stack, "HttpApiUrl", { value: httpApi.url ?? "n/a" });
  }
  if (restApi) {
    new cdk.CfnOutput(stack, "RestApiUrl", { value: restApi.url });
  }
}

