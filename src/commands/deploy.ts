import { loadConfig } from "../config/index.js";
import { assertAwsResolution, resolveAwsConfig } from "../runtime/aws.js";
import { cdkDeploy } from "../runtime/cdk.js";

export interface DeployOptions {
  config: string;
  region?: string;
  profile?: string;
  account?: string;
  requireApproval?: boolean;
}

export function runDeploy(options: DeployOptions): void {
  const config = resolveAwsConfig(loadConfig(options.config), options);
  assertAwsResolution(config);
  cdkDeploy(config, options.requireApproval ?? false);
}
