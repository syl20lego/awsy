import { describe, expect, test } from "vitest";
import { normalizeConfig } from "../src/config/normalize.js";
import { resolveAwsConfig } from "../src/runtime/aws.js";
import { cdkBootstrap } from "../src/runtime/cdk.js";
import {
  normalizedServiceConfigSchema,
  validateServiceConfig,
} from "../src/config/schema.js";

describe("config validation", () => {
  test("validates and normalizes defaults", () => {
    const raw = validateServiceConfig({
      service: "demo",
      functions: { hello: { handler: "src/handler.hello" } },
    });
    const normalized = normalizeConfig(raw);
    expect(normalized.provider.stage).toBe("dev");
    expect(normalized.provider.region).toBeTypeOf("string");
    expect(normalized.stackName).toBe("demo-dev");
  });

  test("rejects invalid function timeout", () => {
    expect(() =>
      validateServiceConfig({
        service: "demo",
        functions: { hello: { handler: "x", timeout: 9999 } },
      }),
    ).toThrow("Invalid YAML config");
  });

  test("normalized output matches normalized schema", () => {
    const raw = validateServiceConfig({
      service: "demo",
      provider: { stage: "prod", region: "eu-west-1" },
      functions: {},
    });
    const normalized = normalizeConfig(raw);
    expect(() => normalizedServiceConfigSchema.parse(normalized)).not.toThrow();
  });

  test("resolveAwsConfig validates and parses merged config", () => {
    const raw = validateServiceConfig({
      service: "demo",
      provider: { stage: "dev", region: "us-east-1" },
      functions: {},
    });
    const normalized = normalizeConfig(raw);
    const resolved = resolveAwsConfig(normalized, { region: "eu-west-1" });
    expect(resolved.provider.region).toBe("eu-west-1");
    expect(() => normalizedServiceConfigSchema.parse(resolved)).not.toThrow();
  });

  test("resolveAwsConfig rejects empty region override", () => {
    const raw = validateServiceConfig({
      service: "demo",
      provider: { stage: "dev", region: "us-east-1" },
      functions: {},
    });
    const normalized = normalizeConfig(raw);
    expect(() => resolveAwsConfig(normalized, { region: "" })).toThrow();
  });

  test("cdkBootstrap symbol is exported", () => {
    expect(typeof cdkBootstrap).toBe("function");
  });

  test("supports provider deployment overrides", () => {
    const raw = validateServiceConfig({
      service: "demo",
      provider: {
        region: "us-east-1",
        deployment: {
          fileAssetsBucketName: "my-assets",
          cloudFormationExecutionRoleArn:
            "arn:aws:iam::123456789012:role/MyExecRole",
          requireBootstrap: false,
        },
      },
      functions: {},
    });
    const normalized = normalizeConfig(raw);
    expect(normalized.provider.deployment?.fileAssetsBucketName).toBe("my-assets");
    expect(normalized.provider.deployment?.requireBootstrap).toBe(false);
  });

  test("supports function build config", () => {
    const raw = validateServiceConfig({
      service: "demo",
      functions: {
        hello: {
          handler: "src/handlers/hello.handler",
          build: {
            mode: "external",
            command: "npm run build:hello",
            handler: "dist/handlers/hello.handler",
          },
        },
      },
    });
    const normalized = normalizeConfig(raw);
    expect(normalized.functions.hello.build?.mode).toBe("external");
  });
});
