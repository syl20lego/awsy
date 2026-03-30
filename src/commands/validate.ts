import { loadConfig } from "../config/index.js";
import { assertAwsResolution } from "../runtime/aws.js";

export function runValidate(configPath: string): void {
  const config = loadConfig(configPath);
  assertAwsResolution(config);
  process.stdout.write(`Config valid: ${configPath}\n`);
}
