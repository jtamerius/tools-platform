import * as fs from 'fs';
import * as path from 'path';

export type EnvName = 'staging' | 'production';

export interface ToolsEnvConfig {
  env: EnvName;
  account: string;
  region: string;
  hostedZoneId: string;
  /** Production domain root (e.g. jtamerius.com) */
  domainRoot: string;
  /** Optional: email for billing/build-failure alerts */
  alertEmail?: string;
  billingAlarmThresholdUSD: number;
}

function loadHostedZoneId(env: EnvName): string {
  const paramsPath = path.join(
    __dirname, '..', '..', 'environments', env, 'params.json',
  );
  const raw = fs.readFileSync(paramsPath, 'utf-8');
  const params: Array<{ ParameterKey: string; ParameterValue: string }> = JSON.parse(raw);
  const entry = params.find(p => p.ParameterKey === 'HostedZoneId');
  if (!entry) throw new Error(`HostedZoneId not found in ${paramsPath}`);
  return entry.ParameterValue;
}

export const configs: Record<EnvName, ToolsEnvConfig> = {
  staging: {
    env: 'staging',
    account: '606196119553',
    region: 'us-east-1',
    hostedZoneId: loadHostedZoneId('staging'),
    domainRoot: 'jtamerius.com',
    billingAlarmThresholdUSD: 20,
  },
  production: {
    env: 'production',
    account: '606196119553',
    region: 'us-east-1',
    hostedZoneId: loadHostedZoneId('production'),
    domainRoot: 'jtamerius.com',
    billingAlarmThresholdUSD: 20,
  },
};
