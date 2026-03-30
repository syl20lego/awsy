import { loadConfig } from "../config/index.js";
import { assertAwsResolution, resolveAwsConfig } from "../runtime/aws.js";
import { cdkSynth } from "../runtime/cdk.js";

export interface SynthOptions {
  config: string;
  region?: string;
  profile?: string;
  account?: string;
}

export function runSynth(options: SynthOptions): void {
  const config = resolveAwsConfig(loadConfig(options.config), options);
  assertAwsResolution(config);
  cdkSynth(config);
}
