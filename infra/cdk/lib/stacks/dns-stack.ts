import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { ToolsEnvConfig } from '../config';

export interface DnsStackProps extends cdk.StackProps {
  cfg: ToolsEnvConfig;
}

export class DnsStack extends cdk.Stack {
  public readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);
    const { cfg } = props;
    const e = cfg.env;

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: cfg.hostedZoneId,
      zoneName: cfg.domainRoot,
    });

    if (e === 'production') {
      this.certificate = new acm.Certificate(this, 'LandingPageCertificate', {
        domainName: `tools.${cfg.domainRoot}`,
        subjectAlternativeNames: [`*.${cfg.domainRoot}`],
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });

      new cdk.CfnOutput(this, 'CertificateArn', {
        value: this.certificate.certificateArn,
        exportName: `tools-shared-dns-${e}-CertificateArn`,
      });
    } else {
      this.certificate = new acm.Certificate(this, 'LandingPageCertificateStagingSubdomain', {
        domainName: `tools.staging.${cfg.domainRoot}`,
        subjectAlternativeNames: [`*.staging.${cfg.domainRoot}`],
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });

      new cdk.CfnOutput(this, 'StagingCertificateArn', {
        value: this.certificate.certificateArn,
        exportName: `tools-shared-dns-${e}-StagingCertificateArn`,
      });
    }

    new cdk.CfnOutput(this, 'HostedZoneId', {
      value: cfg.hostedZoneId,
      exportName: `tools-shared-dns-${e}-HostedZoneId`,
    });

    cdk.Tags.of(this).add('Environment', e);
    cdk.Tags.of(this).add('Project', 'tools-platform');
  }
}
