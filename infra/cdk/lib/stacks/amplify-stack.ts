import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';
import { AmplifyHosting } from '../constructs/amplify-hosting';

export interface AmplifyStackProps extends cdk.StackProps {
  cfg: ToolsEnvConfig;
  /** e.g. 'landing-page', 'weather-app', 'finance-app', 'globe-app' */
  appName: string;
  /** subdomain prefix for custom domain in production */
  subdomain: string;
  amplifyServiceRoleArn: string;
  /** CloudFormation export name prefix, e.g. 'tools-shared-amplify' */
  exportPrefix: string;
  /** Override CFn logical IDs to match a pre-CDK stack (prevents DELETE+CREATE on Amplify app) */
  legacyAppLogicalId?: string;
  legacyBranchLogicalId?: string;
  legacyDomainLogicalId?: string;
}

export class AmplifyStack extends cdk.Stack {
  public readonly appId: string;
  public readonly defaultDomain: string;
  public readonly branchName: string;

  constructor(scope: Construct, id: string, props: AmplifyStackProps) {
    super(scope, id, props);
    const { cfg, appName, subdomain, amplifyServiceRoleArn, exportPrefix, legacyAppLogicalId, legacyBranchLogicalId, legacyDomainLogicalId } = props;
    const e = cfg.env;

    const hosting = new AmplifyHosting(this, 'Hosting', {
      cfg,
      appName,
      subdomain,
      amplifyServiceRoleArn,
      legacyAppLogicalId,
      legacyBranchLogicalId,
      legacyDomainLogicalId,
    });

    this.appId = hosting.appId;
    this.defaultDomain = hosting.defaultDomain;
    this.branchName = hosting.branchName;

    new cdk.CfnOutput(this, 'AmplifyAppId', {
      value: hosting.appId,
      exportName: `${exportPrefix}-${e}-AppId`,
    });

    new cdk.CfnOutput(this, 'AmplifyAppArn', {
      value: hosting.appArn,
      exportName: `${exportPrefix}-${e}-AppArn`,
    });

    new cdk.CfnOutput(this, 'DefaultDomain', {
      value: hosting.defaultDomain,
      exportName: `${exportPrefix}-${e}-DefaultDomain`,
    });

    new cdk.CfnOutput(this, 'BranchName', {
      value: hosting.branchName,
      exportName: `${exportPrefix}-${e}-BranchName`,
    });

    cdk.Tags.of(this).add('Environment', e);
    cdk.Tags.of(this).add('Project', 'tools-platform');
  }
}
