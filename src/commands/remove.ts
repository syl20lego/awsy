import { loadConfig } from "../config/index.js";
import { assertAwsResolution, resolveAwsConfig } from "../runtime/aws.js";
import { cdkDestroy } from "../runtime/cdk.js";

export interface RemoveOptions {
  config: string;
  region?: string;
  profile?: string;
  account?: string;
  force?: boolean;
}

export function runRemove(options: RemoveOptions): void {
  const config = resolveAwsConfig(loadConfig(options.config), options);
  assertAwsResolution(config);
  cdkDestroy(config, options.force ?? false);
}
