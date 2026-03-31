import cdk from "aws-cdk-lib";
import type { NormalizedServiceConfig } from "../config/normalize.js";

export function createStackSynthesizer(
  config: NormalizedServiceConfig,
): cdk.IStackSynthesizer {
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
  const hasExplicitDeploymentInfrastructure = Boolean(
    deployment?.fileAssetsBucketName ||
      deployment?.imageAssetsRepositoryName ||
      deployment?.cloudFormationExecutionRoleArn ||
      deployment?.deployRoleArn ||
      useCliCredentials,
  );
  const requireBootstrap =
    deployment?.requireBootstrap ?? !hasExplicitDeploymentInfrastructure;

  return useCliCredentials
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
}

