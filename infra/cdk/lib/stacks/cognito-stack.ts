import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';

export interface CognitoStackProps extends cdk.StackProps {
  cfg: ToolsEnvConfig;
}

export class CognitoStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);
    const { cfg } = props;
    const e = cfg.env;

    this.userPool = new cognito.UserPool(this, 'CognitoUserPool', {
      userPoolName: `tools-platform-${e}`,
      signInAliases: { email: true },
      autoVerify: { email: true },
      selfSignUpEnabled: true,
      userInvitation: {
        emailSubject: 'Your tools platform invitation',
        emailBody: 'You have been invited to the tools platform. Your username is {username} and your temporary password is {####}. Please sign in at https://tools.jtamerius.com and set a new password.',
      },
      userVerification: {
        emailSubject: 'Verify your email – tools.jtamerius.com',
        emailBody: 'Your email verification code for tools.jtamerius.com is {####}.',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: e === 'production',
    });

    this.userPoolClient = new cognito.UserPoolClient(this, 'CognitoUserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `tools-platform-spa-${e}`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      oAuth: { flows: { authorizationCodeGrant: false, implicitCodeGrant: false } },
    });

    new cognito.CfnUserPoolGroup(this, 'CognitoAdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      description: 'Platform administrators with full access to all internal tools',
      precedence: 1,
    });

    new cognito.CfnUserPoolGroup(this, 'CognitoMemberGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'member',
      description: 'Authenticated members with standard access to tooling',
      precedence: 10,
    });

    new cognito.CfnUserPoolGroup(this, 'CognitoGuestGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'guest',
      description: 'Guest users with limited read-only access to selected tools',
      precedence: 20,
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: `tools-shared-cognito-${e}-UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      exportName: `tools-shared-cognito-${e}-UserPoolArn`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: `tools-shared-cognito-${e}-UserPoolClientId`,
    });

    cdk.Tags.of(this).add('Environment', e);
    cdk.Tags.of(this).add('Project', 'tools-platform');
  }
}
