import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';

export interface IamStackProps extends cdk.StackProps {
  cfg: ToolsEnvConfig;
}

export class IamStack extends cdk.Stack {
  public readonly gitHubActionsRole: iam.Role;
  public readonly amplifyServiceRole: iam.Role;

  constructor(scope: Construct, id: string, props: IamStackProps) {
    super(scope, id, props);
    const { cfg } = props;
    const e = cfg.env;

    // ── OIDC Provider (account-level singleton) ──────────────────────────────
    // Staging: keep the native AWS::IAM::OIDCProvider resource in the stack
    // (preserving the existing CFn logical ID) so CDK doesn't delete it.
    // DeletionPolicy=RETAIN so it survives any future stack tear-down.
    // Production: just import by ARN — it was never created in the prod stack.
    const oidcArn = `arn:aws:iam::${cfg.account}:oidc-provider/token.actions.githubusercontent.com`;
    if (e === 'staging') {
      const oidcResource = new cdk.CfnResource(this, 'GitHubOIDCProvider', {
        type: 'AWS::IAM::OIDCProvider',
        properties: {
          Url: 'https://token.actions.githubusercontent.com',
          ClientIdList: ['sts.amazonaws.com'],
          ThumbprintList: [
            '6938fd4d98bab03faadb97b34396831e3780aea1',
            '1c58a3a8518e8759bf075b76b750d4f2df264fcd',
          ],
        },
      });
      oidcResource.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;
    }
    // Both envs use a reference by ARN for the trust policy (no cross-stack dep).
    const oidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GitHubOIDCProviderRef',
      oidcArn,
    );

    // ── GitHub Actions Role ──────────────────────────────────────────────────
    // overrideLogicalId preserves the existing CFn logical ID so CDK does an
    // UPDATE instead of CREATE+DELETE (which would fail on duplicate role names).
    this.gitHubActionsRole = new iam.Role(this, 'GitHubActionsRole', {
      roleName: `tools-github-actions-${e}`,
      description: `Assumed by GitHub Actions via OIDC to deploy tools-platform stacks for ${e}`,
      assumedBy: new iam.WebIdentityPrincipal(oidcProvider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': 'repo:jtamerius/website_hub:*',
        },
      }),
      maxSessionDuration: cdk.Duration.hours(1),
    });
    (this.gitHubActionsRole.node.defaultChild as iam.CfnRole).overrideLogicalId('GitHubActionsRole');

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CloudFormationFullAccess',
      actions: [
        'cloudformation:CreateStack', 'cloudformation:UpdateStack', 'cloudformation:DeleteStack',
        'cloudformation:DescribeStacks', 'cloudformation:DescribeStackEvents',
        'cloudformation:DescribeStackResources', 'cloudformation:GetTemplate',
        'cloudformation:ValidateTemplate', 'cloudformation:CreateChangeSet',
        'cloudformation:ExecuteChangeSet', 'cloudformation:DescribeChangeSet',
        'cloudformation:DeleteChangeSet', 'cloudformation:ListChangeSets',
        'cloudformation:ListStacks', 'cloudformation:GetTemplateSummary',
      ],
      resources: ['*'],
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'S3ArtifactBucketAccess',
      actions: [
        's3:GetObject', 's3:PutObject', 's3:DeleteObject',
        's3:ListBucket', 's3:GetBucketLocation', 's3:CreateBucket',
      ],
      resources: [
        `arn:aws:s3:::tools-cfn-artifacts-${e}-${cfg.account}`,
        `arn:aws:s3:::tools-cfn-artifacts-${e}-${cfg.account}/*`,
      ],
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AmplifyDeploy',
      actions: [
        'amplify:StartJob', 'amplify:StopJob', 'amplify:GetJob', 'amplify:ListJobs',
        'amplify:CreateDeployment', 'amplify:StartDeployment',
        'amplify:GetApp', 'amplify:ListApps', 'amplify:GetBranch', 'amplify:ListBranches',
      ],
      resources: ['*'],
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SSMGetParameter',
      actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
      resources: [
        `arn:aws:ssm:${cfg.region}:${cfg.account}:parameter/tools/${e}/*`,
        `arn:aws:ssm:${cfg.region}:${cfg.account}:parameter/finance-tracker`,
        `arn:aws:ssm:${cfg.region}:${cfg.account}:parameter/cdk-bootstrap/hnb659fds/version`,
      ],
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CognitoReadOnly',
      actions: [
        'cognito-idp:DescribeUserPool', 'cognito-idp:DescribeUserPoolClient',
        'cognito-idp:ListUserPools', 'cognito-idp:ListUserPoolClients',
        'cognito-idp:GetGroup', 'cognito-idp:ListGroups',
      ],
      resources: ['*'],
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'PassRoleToAmplify',
      actions: ['iam:PassRole'],
      resources: [`arn:aws:iam::${cfg.account}:role/tools-amplify-service-${e}`],
      conditions: {
        StringEquals: { 'iam:PassedToService': 'amplify.amazonaws.com' },
      },
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'PassRoleToLambda',
      actions: ['iam:PassRole'],
      resources: [`arn:aws:iam::${cfg.account}:role/jtamerius-*`],
      conditions: {
        StringEquals: { 'iam:PassedToService': 'lambda.amazonaws.com' },
      },
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'LambdaCRUD',
      actions: [
        'lambda:CreateFunction', 'lambda:UpdateFunctionCode', 'lambda:UpdateFunctionConfiguration',
        'lambda:PublishVersion', 'lambda:GetFunction', 'lambda:GetFunctionConfiguration',
        'lambda:DeleteFunction', 'lambda:AddPermission', 'lambda:RemovePermission',
        'lambda:GetPolicy', 'lambda:CreateFunctionUrlConfig', 'lambda:UpdateFunctionUrlConfig',
        'lambda:GetFunctionUrlConfig', 'lambda:DeleteFunctionUrlConfig', 'lambda:InvokeFunction',
        'lambda:TagResource', 'lambda:UntagResource', 'lambda:ListTags',
        'lambda:PutFunctionConcurrency', 'lambda:DeleteFunctionConcurrency',
        'lambda:GetFunctionConcurrency',
      ],
      resources: [`arn:aws:lambda:${cfg.region}:${cfg.account}:function:jtamerius-*`],
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'LambdaCodeBucket',
      actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket', 's3:CreateBucket'],
      resources: [
        'arn:aws:s3:::jtamerius-website-deploy',
        'arn:aws:s3:::jtamerius-website-deploy/*',
      ],
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'WebsiteBucketFinanceHTML',
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: ['arn:aws:s3:::jtamerius/finance/*'],
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'NewsDataBucket',
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: ['arn:aws:s3:::jtamerius-news-data/*'],
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'EventBridgeCRUD',
      actions: [
        'events:PutRule', 'events:DeleteRule', 'events:DescribeRule',
        'events:EnableRule', 'events:DisableRule', 'events:PutTargets',
        'events:RemoveTargets', 'events:ListTargetsByRule',
      ],
      resources: [`arn:aws:events:${cfg.region}:${cfg.account}:rule/jtamerius-*`],
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'LogGroupCRUD',
      actions: [
        'logs:CreateLogGroup', 'logs:DeleteLogGroup', 'logs:PutRetentionPolicy',
        'logs:DescribeLogGroups', 'logs:TagLogGroup', 'logs:ListTagsLogGroup',
      ],
      resources: [`arn:aws:logs:${cfg.region}:${cfg.account}:log-group:/aws/lambda/jtamerius-*`],
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ManageLambdaExecutionRoles',
      actions: [
        'iam:CreateRole', 'iam:DeleteRole', 'iam:GetRole',
        'iam:PutRolePolicy', 'iam:DeleteRolePolicy', 'iam:GetRolePolicy',
        'iam:AttachRolePolicy', 'iam:DetachRolePolicy',
        'iam:ListRolePolicies', 'iam:ListAttachedRolePolicies',
        'iam:TagRole', 'iam:UntagRole',
      ],
      resources: [`arn:aws:iam::${cfg.account}:role/jtamerius-*`],
    }));

    // ECR push — for building and pushing the SolarHail pipeline Docker image
    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ECRGetAuthToken',
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],  // GetAuthorizationToken is always account-level
    }));

    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ECRPushSolarHail',
      actions: [
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
        'ecr:PutImage',
        'ecr:InitiateLayerUpload',
        'ecr:UploadLayerPart',
        'ecr:CompleteLayerUpload',
        'ecr:DescribeRepositories',
      ],
      resources: [`arn:aws:ecr:${cfg.region}:${cfg.account}:repository/tools-solarhail-pipeline-${e}`],
    }));

    // PassRole to Batch execution and job roles (needed during CDK Batch stack deploy)
    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'PassRoleToBatch',
      actions: ['iam:PassRole'],
      resources: [
        `arn:aws:iam::${cfg.account}:role/tools-solarhail-batch-exec-${e}`,
        `arn:aws:iam::${cfg.account}:role/tools-solarhail-pipeline-${e}`,
      ],
      conditions: {
        StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' },
      },
    }));

    // CDK deploy roles — required after cdk bootstrap
    this.gitHubActionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CDKDeployRoles',
      actions: ['sts:AssumeRole'],
      resources: [
        `arn:aws:iam::${cfg.account}:role/cdk-hnb659fds-deploy-role-${cfg.account}-${cfg.region}`,
        `arn:aws:iam::${cfg.account}:role/cdk-hnb659fds-file-publishing-role-${cfg.account}-${cfg.region}`,
        `arn:aws:iam::${cfg.account}:role/cdk-hnb659fds-lookup-role-${cfg.account}-${cfg.region}`,
      ],
    }));

    // ── News Scraper IAM User (staging only — IAM users are global; production reads
    //    the same SSM params written by the staging stack) ─────────────────────
    if (e === 'staging') {
      const newsScraperUser = new iam.User(this, 'NewsScraperUser', {
        userName: 'jtamerius-news-scraper',
      });
      (newsScraperUser.node.defaultChild as iam.CfnUser).overrideLogicalId('NewsScraperUser');

      newsScraperUser.addToPolicy(new iam.PolicyStatement({
        sid: 'S3Upload',
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: ['arn:aws:s3:::jtamerius-news-data/*'],
      }));

      newsScraperUser.addToPolicy(new iam.PolicyStatement({
        sid: 'SSMReadLLMKeys',
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${cfg.region}:${cfg.account}:parameter/tools/news-scraper/groq-api-key`,
          `arn:aws:ssm:${cfg.region}:${cfg.account}:parameter/tools/news-scraper/gemini-api-key`,
          `arn:aws:ssm:${cfg.region}:${cfg.account}:parameter/tools/news-scraper/hf-api-key`,
          `arn:aws:ssm:${cfg.region}:${cfg.account}:parameter/tools/news-scraper/openrouter-api-key`,
        ],
      }));

      const accessKey = new iam.CfnAccessKey(this, 'NewsScraperAccessKey', {
        userName: newsScraperUser.userName,
      });
      accessKey.overrideLogicalId('NewsScraperAccessKey');

      const accessKeyIdParam = new ssm.CfnParameter(this, 'NewsScraperAccessKeyIdParam', {
        name: '/tools/news-scraper/aws-access-key-id',
        type: 'String',
        value: accessKey.ref,
        description: 'Access key ID for jtamerius-news-scraper IAM user',
      });
      accessKeyIdParam.overrideLogicalId('NewsScraperAccessKeyIdParam');

      const secretAccessKeyParam = new ssm.CfnParameter(this, 'NewsScraperSecretAccessKeyParam', {
        name: '/tools/news-scraper/aws-secret-access-key',
        type: 'String',
        value: accessKey.attrSecretAccessKey,
        description: 'Secret access key for jtamerius-news-scraper IAM user',
      });
      secretAccessKeyParam.overrideLogicalId('NewsScraperSecretAccessKeyParam');
    }

    // ── Amplify Service Role ─────────────────────────────────────────────────
    this.amplifyServiceRole = new iam.Role(this, 'AmplifyServiceRole', {
      roleName: `tools-amplify-service-${e}`,
      description: 'Service role assumed by AWS Amplify Hosting for the tools platform.',
      assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess-Amplify'),
      ],
    });
    (this.amplifyServiceRole.node.defaultChild as iam.CfnRole).overrideLogicalId('AmplifyServiceRole');

    // ── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
      value: this.gitHubActionsRole.roleArn,
      exportName: `tools-shared-iam-${e}-GitHubActionsRoleArn`,
    });

    new cdk.CfnOutput(this, 'AmplifyServiceRoleArn', {
      value: this.amplifyServiceRole.roleArn,
      exportName: `tools-shared-iam-${e}-AmplifyServiceRoleArn`,
    });

    cdk.Tags.of(this).add('Environment', e);
    cdk.Tags.of(this).add('Project', 'tools-platform');
  }
}
