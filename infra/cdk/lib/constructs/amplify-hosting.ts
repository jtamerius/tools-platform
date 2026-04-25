import * as cdk from 'aws-cdk-lib';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';

export interface AmplifyHostingProps {
  cfg: ToolsEnvConfig;
  /** e.g. 'landing-page', 'weather-app' */
  appName: string;
  /** subdomain prefix, e.g. 'tools', 'weather' */
  subdomain: string;
  amplifyServiceRoleArn: string;
  /**
   * Override CFn logical IDs to match an existing stack created outside CDK.
   * Without these, CDK would try DELETE + CREATE, which fails two ways:
   *   1. The account is at the 10-app Amplify limit
   *   2. The custom domain is already validated — re-associating it causes a
   *      domain conflict error and rolls the stack back to UPDATE_ROLLBACK_COMPLETE.
   */
  legacyAppLogicalId?: string;
  legacyBranchLogicalId?: string;
  legacyDomainLogicalId?: string;
}

export class AmplifyHosting extends Construct {
  public readonly appId: string;
  public readonly defaultDomain: string;
  public readonly branchName: string;
  public readonly appArn: string;

  constructor(scope: Construct, id: string, props: AmplifyHostingProps) {
    super(scope, id);
    const { cfg, appName, subdomain, amplifyServiceRoleArn, legacyAppLogicalId, legacyBranchLogicalId, legacyDomainLogicalId } = props;
    const e = cfg.env;
    const branchName = e === 'production' ? 'main' : 'staging';

    const app = new amplify.CfnApp(this, 'App', {
      name: `tools-${appName}-${e}`,
      iamServiceRole: amplifyServiceRoleArn,
      customRules: [
        // Redirect bare /index.html to /
        {
          source: '/index.html',
          target: '/',
          status: '301',
        },
        // SPA fallback — serve index.html for non-asset paths
        {
          source: '</^[^.]+$|\\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|svg|woff|woff2|ttf|map|json)$)([^.]+$)/>',
          target: '/index.html',
          status: '200',
        },
      ],
      enableBranchAutoDeletion: true,
      tags: [
        { key: 'Environment', value: e },
        { key: 'Project', value: 'tools-platform' },
      ],
    });

    if (legacyAppLogicalId) app.overrideLogicalId(legacyAppLogicalId);

    const branch = new amplify.CfnBranch(this, 'Branch', {
      appId: app.attrAppId,
      branchName,
      description: `Deployment target for the ${e} environment`,
      enableAutoBuild: false,
      enablePullRequestPreview: false,
      framework: 'Vite',
      stage: e === 'production' ? 'PRODUCTION' : 'DEVELOPMENT',
      tags: [
        { key: 'Environment', value: e },
        { key: 'Project', value: 'tools-platform' },
      ],
    });

    if (legacyBranchLogicalId) branch.overrideLogicalId(legacyBranchLogicalId);

    // Custom domain only in production
    if (e === 'production') {
      const domain = new amplify.CfnDomain(this, 'Domain', {
        appId: app.attrAppId,
        domainName: cfg.domainRoot,
        subDomainSettings: [
          {
            prefix: subdomain,
            branchName: branch.branchName,
          },
        ],
      });
      if (legacyDomainLogicalId) domain.overrideLogicalId(legacyDomainLogicalId);
    }

    this.appId = app.attrAppId;
    this.appArn = app.attrArn;
    this.defaultDomain = app.attrDefaultDomain;
    this.branchName = branchName;
  }
}
