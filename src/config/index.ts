import { loadRawConfig } from "./load.js";
import {
  normalizeConfig,
  type NormalizedServiceConfig,
} from "./normalize.js";

export function loadConfig(filePath: string): NormalizedServiceConfig {
  const raw = loadRawConfig(filePath);
  return normalizeConfig(raw);
}
