import { describe, expect, test } from "vitest";
import { buildApp } from "../src/compiler/stack-builder.js";
import { normalizeConfig } from "../src/config/normalize.js";
import { validateServiceConfig } from "../src/config/schema.js";

describe("compiler", () => {
  test("synthesizes stack with core resources", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            events: {
              http: [{ method: "GET", path: "/hello" }],
              rest: [{ method: "GET", path: "/hello-rest" }],
            },
          },
        },
        storage: {
          s3: { uploads: {} },
          dynamodb: {
            users: { partitionKey: { name: "pk", type: "string" } },
          },
        },
        messaging: {
          sqs: { jobs: {} },
          sns: { events: {} },
        },
      }),
    );
    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    expect(stackArtifact).toBeTruthy();
    expect(Object.keys(stackArtifact.template.Resources).length).toBeGreaterThan(0);
    expect(stackArtifact.template.Outputs).toHaveProperty("HttpApiUrl");
    expect(stackArtifact.template.Outputs).toHaveProperty("RestApiUrl");
  });

  test("requires API key for all REST routes when provider-level setting is enabled", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          restApi: {
            apiKeyRequired: true,
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            events: {
              rest: [{ method: "GET", path: "/hello" }],
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<string, { Type?: string; Properties?: { ApiKeyRequired?: boolean } }>;
    const restMethods = Object.values(resources).filter(
      (resource) => resource.Type === "AWS::ApiGateway::Method",
    );
    expect(restMethods.length).toBeGreaterThan(0);
    expect(restMethods.every((method) => method.Properties?.ApiKeyRequired === true)).toBe(true);
  });

  test("applies function-level REST API key when no provider-level setting exists", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            restApi: {
              apiKeyRequired: true,
            },
            events: {
              rest: [{ method: "GET", path: "/hello" }],
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const resources = stackArtifact.template.Resources as Record<string, { Type?: string; Properties?: { ApiKeyRequired?: boolean } }>;
    const restMethods = Object.values(resources).filter(
      (resource) => resource.Type === "AWS::ApiGateway::Method",
    );
    expect(restMethods.length).toBeGreaterThan(0);
    expect(restMethods.every((method) => method.Properties?.ApiKeyRequired === true)).toBe(true);
  });

  test("supports direct role ARN in function iam list", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: { account: "123456789012", region: "us-east-1" },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            iam: ["arn:aws:iam::123456789012:role/AldoBasicLambdaRole"],
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    expect(stackArtifact).toBeTruthy();
  });

  test("rejects mixing role ARN and iam statement keys", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: { account: "123456789012", region: "us-east-1" },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
            iam: [
              "arn:aws:iam::123456789012:role/AldoBasicLambdaRole",
              "readUsers",
            ],
          },
        },
        iam: {
          statements: {
            readUsers: {
              actions: ["dynamodb:GetItem"],
              resources: ["*"],
            },
          },
        },
      }),
    );

    expect(() => buildApp(config)).toThrow(
      "mixes a role ARN with iam statement references",
    );
  });

  test("applies custom deployment synthesizer settings", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            fileAssetsBucketName: "custom-assets-bucket",
            requireBootstrap: false,
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    expect(stackArtifact).toBeTruthy();
  });

  test("infers bootstrap rule disabled when deployment overrides are provided", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            fileAssetsBucketName: "custom-assets-bucket",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const rules =
      (stackArtifact.template as { Rules?: Record<string, unknown> }).Rules ?? {};
    expect(Object.keys(rules)).toHaveLength(0);
  });

  test("keeps bootstrap rule by default when no deployment overrides exist", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    const { app } = buildApp(config);
    const assembly = app.synth();
    const stackArtifact = assembly.getStackArtifact(config.stackName);
    const rules =
      (stackArtifact.template as { Rules?: Record<string, unknown> }).Rules ?? {};
    expect(Object.keys(rules).length).toBeGreaterThan(0);
  });

  test("infers cli credentials synthesizer when only asset overrides are provided", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            fileAssetsBucketName: "custom-assets-bucket",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    const { stack } = buildApp(config);
    expect(stack.synthesizer.constructor.name).toBe("CliCredentialsStackSynthesizer");
  });

  test("does not infer cli credentials synthesizer when role overrides are provided", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            fileAssetsBucketName: "custom-assets-bucket",
            deployRoleArn: "arn:aws:iam::123456789012:role/MyDeployRole",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    const { stack } = buildApp(config);
    expect(stack.synthesizer.constructor.name).toBe("DefaultStackSynthesizer");
  });

  test("rejects explicit cli credentials with role overrides", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            useCliCredentials: true,
            deployRoleArn: "arn:aws:iam::123456789012:role/MyDeployRole",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    expect(() => buildApp(config)).toThrow(
      "cannot be combined with deploy/cloudformation role overrides",
    );
  });

  test("rejects cloudFormationServiceRoleArn with deployment role overrides", () => {
    const config = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          account: "123456789012",
          region: "us-east-1",
          deployment: {
            cloudFormationServiceRoleArn:
              "arn:aws:iam::123456789012:role/MyCloudFormationServiceRole",
            deployRoleArn: "arn:aws:iam::123456789012:role/MyDeployRole",
          },
        },
        functions: {
          hello: {
            handler: "src/hello.handler",
            build: {
              mode: "external",
              command: "node -e \"require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/hello.js','exports.handler=async()=>({statusCode:200,body:\\\"ok\\\"});')\"",
              handler: "src/hello.handler",
            },
          },
        },
      }),
    );

    expect(() => buildApp(config)).toThrow(
      "cloudFormationServiceRoleArn cannot be combined with deployRoleArn/cloudFormationExecutionRoleArn",
    );
  });
});
