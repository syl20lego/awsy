import type { NormalizedServiceConfig } from "../../config/normalize.js";

export function validateCrossDomainConfig(config: NormalizedServiceConfig): void {
  const hasAutoDeleteBucket = Object.values(config.storage.s3).some(
    (bucket) => bucket.autoDeleteObjects === true,
  );
  if (hasAutoDeleteBucket && !config.provider.s3?.cleanupRoleArn) {
    throw new Error(
      `S3 auto-delete requires provider.s3.cleanupRoleArn. Set storage.s3.<bucket>.autoDeleteObjects=false or provide provider.s3.cleanupRoleArn.`,
    );
  }
}

export function validateDeploymentMode(config: NormalizedServiceConfig): void {
  const deployment = config.provider.deployment;
  const hasAssetLocationOverrides = Boolean(
    deployment?.fileAssetsBucketName || deployment?.imageAssetsRepositoryName,
  );
  const hasRoleOverrides = Boolean(
    deployment?.cloudFormationExecutionRoleArn || deployment?.deployRoleArn,
  );
  const hasCloudFormationServiceRole = Boolean(
    deployment?.cloudFormationServiceRoleArn,
  );
  const inferredUseCliCredentials = hasAssetLocationOverrides && !hasRoleOverrides;
  const useCliCredentials =
    deployment?.useCliCredentials ?? inferredUseCliCredentials;

  if (useCliCredentials && hasRoleOverrides) {
    throw new Error(
      `provider.deployment.useCliCredentials=true cannot be combined with deploy/cloudformation role overrides. Choose one mode.`,
    );
  }
  if (hasCloudFormationServiceRole && hasRoleOverrides) {
    throw new Error(
      `provider.deployment.cloudFormationServiceRoleArn cannot be combined with deployRoleArn/cloudFormationExecutionRoleArn in this mode.`,
    );
  }
}

