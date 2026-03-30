import cdk from "aws-cdk-lib";
import { Duration, Stack, type StackProps, Tags } from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import type { IamStatementConfig } from "../config/schema.js";
import type { NormalizedServiceConfig } from "../config/normalize.js";
import { prepareFunctionBuilds } from "../runtime/build.js";

function attrType(
  value: "string" | "number" | "binary",
): dynamodb.AttributeType {
  if (value === "string") return dynamodb.AttributeType.STRING;
  if (value === "number") return dynamodb.AttributeType.NUMBER;
  return dynamodb.AttributeType.BINARY;
}

function withStageName(base: string, stage: string): string {
  return `${base}-${stage}`;
}

function resolveIamPolicy(
  statement: IamStatementConfig,
  resources: Record<string, Construct>,
): iam.PolicyStatement {
  const resolvedResources = statement.resources.map((res) => {
    if (res.startsWith("ref:")) {
      const key = res.replace("ref:", "");
      const value = resources[key];
      if (!value) {
        throw new Error(`IAM reference "${key}" not found`);
      }
      if ("bucketArn" in value) {
        return (value as s3.Bucket).bucketArn;
      }
      if ("queueArn" in value) {
        return (value as sqs.Queue).queueArn;
      }
      if ("topicArn" in value) {
        return (value as sns.Topic).topicArn;
      }
      if ("tableArn" in value) {
        return (value as dynamodb.Table).tableArn;
      }
      throw new Error(`Unsupported ref target "${key}" in IAM resource`);
    }
    return res;
  });

  return new iam.PolicyStatement({
    sid: statement.sid,
    effect:
      statement.effect === "Deny" ? iam.Effect.DENY : iam.Effect.ALLOW,
    actions: statement.actions,
    resources: resolvedResources,
  });
}

function isIamRoleArn(value: string): boolean {
  return /^arn:aws:iam::\d{12}:role\/.+/.test(value);
}

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

    const refs: Record<string, Construct> = {};

    for (const [name, bucket] of Object.entries(config.storage.s3)) {
      refs[name] = new s3.Bucket(this, `Bucket${name}`, {
        bucketName: withStageName(name.toLowerCase(), config.provider.stage),
        versioned: bucket.versioned ?? false,
      });
    }

    for (const [name, table] of Object.entries(config.storage.dynamodb)) {
      refs[name] = new dynamodb.Table(this, `Table${name}`, {
        tableName: withStageName(name, config.provider.stage),
        partitionKey: {
          name: table.partitionKey.name,
          type: attrType(table.partitionKey.type),
        },
        sortKey: table.sortKey
          ? {
              name: table.sortKey.name,
              type: attrType(table.sortKey.type),
            }
          : undefined,
        billingMode:
          table.billingMode === "PROVISIONED"
            ? dynamodb.BillingMode.PROVISIONED
            : dynamodb.BillingMode.PAY_PER_REQUEST,
      });
    }

    for (const [name, queue] of Object.entries(config.messaging.sqs)) {
      refs[name] = new sqs.Queue(this, `Queue${name}`, {
        queueName: withStageName(name, config.provider.stage),
        visibilityTimeout: queue.visibilityTimeout
          ? Duration.seconds(queue.visibilityTimeout)
          : undefined,
      });
    }

    for (const [name, topic] of Object.entries(config.messaging.sns)) {
      const topicResource = new sns.Topic(this, `Topic${name}`, {
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

    const httpApi = new apigwv2.HttpApi(
      this,
      "HttpApi",
      {
        apiName: withStageName(config.service, config.provider.stage),
      },
    );
    const hasRestRoutes = Object.values(config.functions).some(
      (fn) => (fn.events?.rest?.length ?? 0) > 0,
    );
    const restApi = hasRestRoutes
      ? new apigw.RestApi(this, "RestApi", {
          restApiName: withStageName(`${config.service}-rest`, config.provider.stage),
          deployOptions: {
            stageName: config.provider.stage,
          },
        })
      : undefined;
    const globalRestApiKeyRequired = config.provider.restApi?.apiKeyRequired;
    let hasAnyRestApiKeyRequired = false;
    const buildOutputs = prepareFunctionBuilds(config);

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
        ? iam.Role.fromRoleArn(
            this,
            `FunctionRole${name}`,
            roleArnEntry,
            {
              mutable: false,
            },
          )
        : undefined;

      const build = buildOutputs[name];
      const fnResource = new lambda.Function(this, `Function${name}`, {
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
        httpApi.addRoutes({
          path: route.path,
          methods: [
            route.method.toUpperCase() as apigwv2.HttpMethod,
          ],
          integration:
            new apigwv2Integrations.HttpLambdaIntegration(
              `${name}-${route.method}-${route.path}`,
              fnResource,
            ),
        });
      }

      const functionRestApiKeyRequired =
        globalRestApiKeyRequired ?? fn.restApi?.apiKeyRequired ?? false;
      for (const route of fn.events?.rest ?? []) {
        if (!restApi) {
          continue;
        }
        const normalizedMethod = route.method.toUpperCase();
        const resource = restApi.root.resourceForPath(route.path);
        resource.addMethod(
          normalizedMethod,
          new apigw.LambdaIntegration(fnResource, { proxy: true }),
          { apiKeyRequired: functionRestApiKeyRequired },
        );
        if (functionRestApiKeyRequired) {
          hasAnyRestApiKeyRequired = true;
        }
      }
    }

    if (restApi && hasAnyRestApiKeyRequired) {
      const apiKey = restApi.addApiKey("RestApiKey");
      const usagePlan = restApi.addUsagePlan("RestApiUsagePlan", {
        name: withStageName(`${config.service}-rest-plan`, config.provider.stage),
      });
      usagePlan.addApiKey(apiKey);
      usagePlan.addApiStage({
        stage: restApi.deploymentStage,
      });
    }

    new cdk.CfnOutput(this, "HttpApiUrl", { value: httpApi.url ?? "n/a" });
    if (restApi) {
      new cdk.CfnOutput(this, "RestApiUrl", { value: restApi.url });
    }
  }
}

export function buildApp(
  config: NormalizedServiceConfig,
  options?: { outdir?: string },
): { app: cdk.App; stack: ServiceStack } {
  const app = new cdk.App({ outdir: options?.outdir });
  const deployment = config.provider.deployment;
  const hasAssetLocationOverrides = Boolean(
    deployment?.fileAssetsBucketName || deployment?.imageAssetsRepositoryName,
  );
  const hasRoleOverrides = Boolean(
    deployment?.cloudFormationExecutionRoleArn || deployment?.deployRoleArn,
  );
  const inferredUseCliCredentials = hasAssetLocationOverrides && !hasRoleOverrides;
  const useCliCredentials =
    deployment?.useCliCredentials ?? inferredUseCliCredentials;
  if (useCliCredentials && hasRoleOverrides) {
    throw new Error(
      `provider.deployment.useCliCredentials=true cannot be combined with deploy/cloudformation role overrides. Choose one mode.`,
    );
  }
  const hasExplicitDeploymentInfrastructure = Boolean(
    deployment?.fileAssetsBucketName ||
      deployment?.imageAssetsRepositoryName ||
      deployment?.cloudFormationExecutionRoleArn ||
      deployment?.deployRoleArn ||
      useCliCredentials,
  );
  const requireBootstrap =
    deployment?.requireBootstrap ?? !hasExplicitDeploymentInfrastructure;
  const synthesizer = useCliCredentials
    ? new cdk.CliCredentialsStackSynthesizer({
        fileAssetsBucketName: deployment?.fileAssetsBucketName,
        imageAssetsRepositoryName: deployment?.imageAssetsRepositoryName,
        qualifier: deployment?.qualifier,
      })
    : new cdk.DefaultStackSynthesizer({
        fileAssetsBucketName: deployment?.fileAssetsBucketName,
        imageAssetsRepositoryName: deployment?.imageAssetsRepositoryName,
        cloudFormationExecutionRole: deployment?.cloudFormationExecutionRoleArn,
        deployRoleArn: deployment?.deployRoleArn,
        qualifier: deployment?.qualifier,
        generateBootstrapVersionRule: requireBootstrap,
      });
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
