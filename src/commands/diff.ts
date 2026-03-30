import { loadConfig } from "../config/index.js";
import { assertAwsResolution, resolveAwsConfig } from "../runtime/aws.js";
import { cdkDiff } from "../runtime/cdk.js";

export interface DiffOptions {
  config: string;
  region?: string;
  profile?: string;
  account?: string;
}

export function runDiff(options: DiffOptions): void {
  const config = resolveAwsConfig(loadConfig(options.config), options);
  assertAwsResolution(config);
  cdkDiff(config);
}
