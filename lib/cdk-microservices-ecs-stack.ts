import {RemovalPolicy, ScopedAws, Stack, StackProps} from "aws-cdk-lib";
import {Construct} from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import {DockerImageAsset, Platform} from "aws-cdk-lib/aws-ecr-assets";
import * as ecrdeploy from "cdk-ecr-deployment";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "path";

export class CdkMicroservicesEcsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const {accountId, region} = new ScopedAws(this);
    const resourceName = "cdk-microservices-ecs";

    const ecrRepository = new ecr.Repository(this, `${resourceName}-ecr-repo`, {
      repositoryName: `${resourceName}-ecr-repo`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteImages: true,
    });

    const dockerImageAsset = new DockerImageAsset(
      this,
      "DockerImageAssetSample",
      {
        directory: path.join(__dirname, "..", "docker"),
        platform: Platform.LINUX_AMD64,
      }
    );

    new ecrdeploy.ECRDeployment(this, `${resourceName}-ecr-deployment`, {
      src: new ecrdeploy.DockerImageName(dockerImageAsset.imageUri),
      dest: new ecrdeploy.DockerImageName(
        `${accountId}.dkr.ecr.${region}.amazonaws.com/${ecrRepository.repositoryName}:latest`
      ),
    });

    const vpc = new ec2.Vpc(this, `${resourceName}-vpc`, {
      vpcName: `${resourceName}-vpc`,
      maxAzs: 2,
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/20"),
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: `${resourceName}-public`,
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    const cluster = new ecs.Cluster(this, `${resourceName}-cluster`, {
      clusterName: `${resourceName}-cluster`,
      vpc: vpc,
    });

    const logGroup = new logs.LogGroup(this, `${resourceName}-log-group`, {
      logGroupName: `/aws/ecs/${resourceName}`,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      `${resourceName}-service`,
      {
        loadBalancerName: `${resourceName}-lb`,
        publicLoadBalancer: true,
        cluster: cluster,
        serviceName: `${resourceName}-service`,
        cpu: 256,
        desiredCount: 2,
        memoryLimitMiB: 512,
        assignPublicIp: true,
        taskSubnets: {subnetType: ec2.SubnetType.PUBLIC},
        taskImageOptions: {
          family: `${resourceName}-taskdef`,
          containerName: `${resourceName}-container`,
          image: ecs.ContainerImage.fromEcrRepository(ecrRepository, "latest"),
          logDriver: new ecs.AwsLogDriver({
            streamPrefix: `container`,
            logGroup: logGroup,
          }),
        },
      }
    );
  }
}
