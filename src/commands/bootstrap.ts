import { loadConfig } from "../config/index.js";
import { assertAwsResolution, resolveAwsConfig } from "../runtime/aws.js";
import { cdkBootstrap } from "../runtime/cdk.js";

export interface BootstrapOptions {
  config: string;
  region?: string;
  profile?: string;
  account?: string;
}

export function runBootstrap(options: BootstrapOptions): void {
  const config = resolveAwsConfig(loadConfig(options.config), options);
  assertAwsResolution(config);
  cdkBootstrap(config);
}
