import cdk = require('@aws-cdk/core');
import eks = require('@aws-cdk/aws-eks');
import iam = require('@aws-cdk/aws-iam');
import autoscaling = require('@aws-cdk/aws-autoscaling');

/**
 * The properties for the Cluster Autoscaler.
 */
export interface ClusterAutoscalerProps {

  /**
   * The EKS cluster to deploy the cluster autoscaler to.
   *
   * @default none
   */
  cluster: eks.Cluster;

  /**
   * An array of Autoscaling Groups, known as node groups, to configure for autoscaling.
   *
   * @default none
   */
  nodeGroups: Array<autoscaling.AutoScalingGroup>;

  /**
   * The version of the Cluster Autoscaler to deploy.
   *
   * @default v1.14.6
   */
  version?: String;

}

/**
 * The Cluster Autoscaler Construct. This will create a new IAM Policy, add labels to the ASGs, and
 * deploy the Cluster Autoscaler manifest.
 */
export class ClusterAutoscaler extends cdk.Construct {

  /**
   *  The IAM policy created by this construct.
   */
  public readonly policy: iam.Policy

  /**
   * The Kubernetes Resource that defines the Cluster Autoscaler K8s resources.
   */
  public readonly clusterAutoscaler: eks.KubernetesManifest

  /**
   * Constructs a new instance of the Cluster Autoscaler.
   *
   * @param scope cdk.Construct
   * @param id string
   * @param props ClusterAutoscalerProps
   */
  constructor(scope: cdk.Construct, id: string, props: ClusterAutoscalerProps) {
    super(scope, id);

    // default the version to the latest version
    if(!props.version) {
      props.version = 'v1.14.6';
    }

    // define the cluster autoscaler policy statements
    // https://docs.aws.amazon.com/en_pv/eks/latest/userguide/cluster-autoscaler.html#ca-create-ngs
    const policyStatement = new iam.PolicyStatement();
    policyStatement.addResources('*');
    policyStatement.addActions(
      'autoscaling:DescribeAutoScalingGroups',
      'autoscaling:DescribeAutoScalingInstances',
      'autoscaling:DescribeLaunchConfigurations',
      'autoscaling:DescribeTags',
      'autoscaling:SetDesiredCapacity',
      'autoscaling:TerminateInstanceInAutoScalingGroup',
      'ec2:DescribeLaunchTemplateVersions'
    );

    // create the policy based on the statements
    const policy = new iam.Policy(this, 'cluster-autoscaler-policy', {
      policyName: 'ClusterAutoscalerPolicy',
      statements: [ policyStatement ]
    });

    // loop through all of the node groups and attach the policy
    props.nodeGroups.forEach(element => {
      cdk.Tag.add(element, 'k8s.io/cluster-autoscaler/' + props.cluster.clusterName, 'owned', { applyToLaunchedInstances: true });
      cdk.Tag.add(element, 'k8s.io/cluster-autoscaler/enabled', 'true', { applyToLaunchedInstances: true });
      policy.attachToRole(element.role);
    });

    // define the Kubernetes Cluster Autoscaler manifests
    this.clusterAutoscaler = new eks.KubernetesManifest(this, 'cluster-autoscaler-manifest', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'ServiceAccount',
          metadata: {
            name: 'cluster-autoscaler',
            namespace: 'kube-system',
            labels: {
              'k8s-addon': 'cluster-autoscaler.addons.k8s.io',
              'k8s-app': 'cluster-autoscaler'
            }
          }
        },
        {
          apiVersion: 'rbac.authorization.k8s.io/v1',
          kind: 'ClusterRole',
          metadata: {
            name: 'cluster-autoscaler',
            namespace: 'kube-system',
            labels: {
              'k8s-addon': 'cluster-autoscaler.addons.k8s.io',
              'k8s-app': 'cluster-autoscaler'
            }
          },
          rules: [
            {
              apiGroups: [''],
              resources: ['events', 'endpoints'],
              verbs: ['create', 'patch']
            },
            {
              apiGroups: [''],
              resources: ['pods/eviction'],
              verbs: ['create']
            },
            {
              apiGroups: [''],
              resources: ['pods/status'],
              verbs: ['update']
            },
            {
              apiGroups: [''],
              resources: ['endpoints'],
              resourceNames: ['cluster-autoscaler'],
              verbs: ['get', 'update']
            },
            {
              apiGroups: [''],
              resources: ['nodes'],
              verbs: ['watch', 'list', 'get', 'update']
            },
            {
              apiGroups: [''],
              resources: ['pods', 'services', 'replicationcontrollers', 'persistentvolumeclaims', 'persistentvolumes' ],
              verbs: ['watch', 'list', 'get']
            },
            {
              apiGroups: ['extensions'],
              resources: ['replicasets', 'daemonsets'],
              verbs: ['watch', 'list', 'get']
            },
            {
              apiGroups: ['policy'],
              resources: ['poddisruptionbudgets'],
              verbs: ['watch', 'list']
            },
            {
              apiGroups: ['apps'],
              resources: ['statefulsets', 'replicasets', 'daemonsets'],
              verbs: ['watch', 'list', 'get']
            },
            {
              apiGroups: ['storage.k8s.io'],
              resources: ['storageclasses', 'csinodes'],
              verbs: ['watch', 'list', 'get']
            },
            {
              apiGroups: ['batch', 'extensions'],
              resources: ['jobs'],
              verbs: ['get', 'list', 'watch', 'patch']
            },
            {
              apiGroups: ['coordination.k8s.io'],
              resources: ['leases'],
              verbs: ['create']
            },
            {
              apiGroups: ['coordination.k8s.io'],
              resourceNames: ['cluster-autoscaler'],
              resources: ['leases'],
              verbs: ['get', 'update']
            }
          ]
        },
        {
          apiVersion: 'rbac.authorization.k8s.io/v1',
          kind: 'Role',
          metadata: {
            name: 'cluster-autoscaler',
            namespace: 'kube-system',
            labels: {
              'k8s-addon': 'cluster-autoscaler.addons.k8s.io',
              'k8s-app': 'cluster-autoscaler'
            }
          },
          rules: [
            {
              apiGroups: [''],
              resources: ['configmaps'],
              verbs: ['create','list','watch']
            },
            {
              apiGroups: [''],
              resources: ['configmaps'],
              resourceNames: ['cluster-autoscaler-status', 'cluster-autoscaler-priority-expander'],
              verbs: ['delete', 'get', 'update', 'watch']
            }
          ]
        },
        {
          apiVersion: 'rbac.authorization.k8s.io/v1',
          kind: 'ClusterRoleBinding',
          metadata: {
            name: 'cluster-autoscaler',
            namespace: 'kube-system',
            labels: {
              'k8s-addon': 'cluster-autoscaler.addons.k8s.io',
              'k8s-app': 'cluster-autoscaler'
            }
          },
          roleRef: {
            apiGroup: 'rbac.authorization.k8s.io',
            kind: 'ClusterRole',
            name: 'cluster-autoscaler'
          },
          subjects: [
            {
              kind: 'ServiceAccount',
              name: 'cluster-autoscaler',
              namespace: 'kube-system'
            }
          ]
        },
        {
          apiVersion: 'rbac.authorization.k8s.io/v1',
          kind: 'RoleBinding',
          metadata: {
            name: 'cluster-autoscaler',
            namespace: 'kube-system',
            labels: {
              'k8s-addon': 'cluster-autoscaler.addons.k8s.io',
              'k8s-app': 'cluster-autoscaler'
            }
          },
          roleRef: {
            apiGroup: 'rbac.authorization.k8s.io',
            kind: 'Role',
            name: 'cluster-autoscaler'
          },
          subjects: [
            {
              kind: 'ServiceAccount',
              name: 'cluster-autoscaler',
              namespace: 'kube-system'
            }
          ]
        },
        {
          apiVersion: 'rbac.authorization.k8s.io/v1',
          kind: 'RoleBinding',
          metadata: {
            name: 'cluster-autoscaler',
            namespace: 'kube-system',
            labels: {
              'k8s-addon': 'cluster-autoscaler.addons.k8s.io',
              'k8s-app': 'cluster-autoscaler'
            }
          },
          roleRef: {
            apiGroup: 'rbac.authorization.k8s.io',
            kind: 'Role',
            name: 'cluster-autoscaler'
          },
          subjects: [
            {
              kind: 'ServiceAccount',
              name: 'cluster-autoscaler',
              namespace: 'kube-system'
            }
          ]
        },
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: {
            name: 'cluster-autoscaler',
            namespace: 'kube-system',
            labels: {
              app: 'cluster-autoscaler'
            },
            annotations: {
              'cluster-autoscaler.kubernetes.io/safe-to-evict': 'false'
            }
          },
          spec: {
            replicas: 1,
            selector: {
              matchLabels: {
                app: 'cluster-autoscaler'
              }
            },
            template: {
              metadata: {
                labels: {
                  app: 'cluster-autoscaler'
                },
                annotations: {
                  'prometheus.io/scrape': 'true',
                  'prometheus.io/port': '8085'
                }
              },
              spec: {
                serviceAccountName: 'cluster-autoscaler',
                containers: [
                   {
                    image: 'k8s.gcr.io/autoscaling/cluster-autoscaler:' + props.version,
                      name: 'cluster-autoscaler',
                      resources: {
                         limits: {
                            cpu: '100m',
                            memory: '300Mi'
                         },
                         requests: {
                            cpu: '100m',
                            memory: '300Mi'
                         }
                      },
                      command: [
                        './cluster-autoscaler',
                        '--v=4',
                        '--stderrthreshold=info',
                        '--cloud-provider=aws',
                        '--skip-nodes-with-local-storage=false',
                        '--expander=least-waste',
                        '--node-group-auto-discovery=asg:tag=k8s.io/cluster-autoscaler/enabled,k8s.io/cluster-autoscaler/' + props.cluster.clusterName,
                        '--balance-similar-node-groups',
                        '--skip-nodes-with-system-pods=false'
                      ],
                      volumeMounts: [
                         {
                            name: 'ssl-certs',
                            mountPath: '/etc/ssl/certs/ca-certificates.crt',
                            readOnly: true
                         }
                      ],
                      imagePullPolicy: 'Always'
                   }
                ],
                volumes: [
                   {
                    name: 'ssl-certs',
                    hostPath: {
                      path: '/etc/ssl/certs/ca-bundle.crt'
                    }
                   }
                ]
             }
            }
          }
        }
      ]
    });
  }
}
