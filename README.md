# awsy

`awsy` (short for **AWS YAML**) is a TypeScript CLI that lets you define AWS infrastructure in YAML, compiles it to AWS CDK, and manages deployment as CloudFormation stacks.

## Features

- AWS-only scope (no multi-cloud abstraction)
- YAML config with schema validation
- CDK-backed synth/deploy/diff/destroy workflow
- Core v1 resources:
  - Lambda
  - API Gateway HTTP API
  - S3
  - DynamoDB
  - SQS
  - SNS
  - IAM statement bindings for functions

## Install

```bash
npm install
npm run build
```

If you use `awsy` from another project (linked or path-installed), make sure this CLI package's dependencies are installed in its own directory (`npm install` in the `awsy` project), since CDK CLI execution uses the package-local `aws-cdk` binary.

When using `aws-yaml-cdk-cli` as a `file:` dependency, install `aws-cdk` in the consuming project as well:

```bash
npm i -D aws-cdk
```

`awsy` will resolve `aws-cdk` from the current project first, then fall back to the CLI package copy.

## Usage

```bash
npx tsx src/cli.ts init --config awsy.yml
npx tsx src/cli.ts validate --config awsy.yml
npx tsx src/cli.ts bootstrap --config awsy.yml --region us-east-1 --account 123456789012
npx tsx src/cli.ts synth --config awsy.yml --region us-east-1
npx tsx src/cli.ts diff --config awsy.yml --region us-east-1
npx tsx src/cli.ts deploy --config awsy.yml --region us-east-1
npx tsx src/cli.ts remove --config awsy.yml --region us-east-1 --force
```

## Use from another project

### Option 1: Link globally for local development

From this CLI project:

```bash
npm install
npm run build
npm link
```

From another project:

```bash
awsy --help
awsy validate -c awsy.yml
awsy deploy -c awsy.yml --region us-east-1
```

### Option 2: Install via local path in a target project

From the target project:

```bash
npm i -D /absolute/path/to/kappa
npx awsy --help
npx awsy validate -c awsy.yml
```

### Option 3: Publish and consume as a package

This repo includes a GitHub Actions workflow at `.github/workflows/publish-npm.yml` that publishes to npm when a GitHub Release is published.

Setup:

1. Create an npm access token (`Automation` token type is recommended).
2. Add it to this repo as a GitHub secret named `NPM_TOKEN`.
3. Ensure `package.json` has the final package name/version you want to release.
4. Publish a GitHub Release (or run the workflow manually with `workflow_dispatch`).

What the workflow does:

- `npm ci`
- `npm run build`
- `npm test`
- `npm publish --provenance --access public`

Consume it in another project with:

```bash
npm i -D aws-yaml-cdk-cli
```

## YAML shape (v1)

See `examples/service.yml` for a complete example.

Top-level sections:
- `service`
- `provider` (`region`, `stage`, optional `account`, `profile`, `stackName`, `tags`, `deployment`)
- `functions`
- `storage` (`s3`, `dynamodb`)
- `messaging` (`sqs`, `sns`)
- `iam` (statement map referenced by functions)

`functions.<name>.iam` supports:
- references to `iam.statements` keys, or
- a direct role ARN like `arn:aws:iam::<account-id>:role/<role-name>`

Use one mode per function (do not mix role ARN and statement keys in the same function).

`functions.<name>.handler` packaging behavior:

- awsy uses **native TypeScript build by default** (`build.mode: typescript`).
- It compiles each handler and deploys compiled output rather than whole project source.
- Example:

```yaml
functions:
  hello:
    handler: src/handlers/hello.handler
    build:
      mode: typescript
```

Pluggable bundlers (`esbuild`, `vite`, `turbopack`, custom) are supported via external build commands:

```yaml
functions:
  hello:
    handler: src/handlers/hello.handler
    build:
      mode: external
      command: npm run build:hello
      handler: dist/handlers/hello.handler
```

### Optional provider.deployment overrides (advanced)

You can provide CDK deployment infrastructure settings directly in YAML:

- `provider.deployment.fileAssetsBucketName`
- `provider.deployment.imageAssetsRepositoryName`
- `provider.deployment.cloudFormationExecutionRoleArn`
- `provider.deployment.deployRoleArn`
- `provider.deployment.qualifier`
- `provider.deployment.useCliCredentials`
- `provider.deployment.requireBootstrap` (optional explicit override)

Bootstrap inference behavior:

- If deployment overrides are provided (`fileAssetsBucketName`, `imageAssetsRepositoryName`, `cloudFormationExecutionRoleArn`, `deployRoleArn`, or `useCliCredentials`), awsy automatically disables the bootstrap version rule.
- If no deployment overrides are provided, awsy keeps bootstrap version checks enabled.
- `requireBootstrap` can still explicitly override either behavior.

`useCliCredentials` inference behavior:

- If you provide asset location overrides (`fileAssetsBucketName` or `imageAssetsRepositoryName`) **without** role overrides, awsy infers `useCliCredentials: true`.
- If role overrides are present (`cloudFormationExecutionRoleArn` or `deployRoleArn`), awsy uses `DefaultStackSynthesizer` unless you explicitly set `useCliCredentials`.
- Explicit `useCliCredentials` in YAML always wins.
- `useCliCredentials: true` cannot be combined with role overrides (`deployRoleArn` / `cloudFormationExecutionRoleArn`).

Example:

```yaml
provider:
  region: us-east-1
  account: "638914547607"
  deployment:
    fileAssetsBucketName: my-cdk-assets-us-east-1
    cloudFormationExecutionRoleArn: arn:aws:iam::638914547607:role/MyCfnExecRole
    deployRoleArn: arn:aws:iam::638914547607:role/MyCdkDeployRole
    requireBootstrap: false
```

Bootstrapless-style deploy example (no `cdk bootstrap`):

Use `CliCredentialsStackSynthesizer` mode by setting asset locations and `useCliCredentials: true`, and do **not** set `deployRoleArn` / `cloudFormationExecutionRoleArn`.

```yaml
service: my-api
provider:
  region: us-east-1
  stage: dev
  account: "638914547607"
  stackName: my-api-dev
  deployment:
    fileAssetsBucketName: my-precreated-assets-us-east-1
    # Only needed if you deploy container image assets:
    imageAssetsRepositoryName: my-precreated-cdk-images
    useCliCredentials: true
    requireBootstrap: false
functions:
  hello:
    handler: src/handlers/hello.handler
```

Deploy:

```bash
awsy deploy -c awsy.yml --region us-east-1
```

Notes for this mode:

- Pre-create and grant write access to `fileAssetsBucketName` (and image repo if used).
- Run with AWS credentials that can upload assets and deploy CloudFormation.
- If you set role overrides (`deployRoleArn` / `cloudFormationExecutionRoleArn`), CDK switches to `DefaultStackSynthesizer`, which requires a bootstrapped environment.

## Notes

- Use `ref:<resourceName>` in IAM resources to reference ARNs generated for `s3`, `dynamodb`, `sqs`, and `sns`.
- Region resolution order: CLI flag -> YAML `provider.region` -> `AWS_REGION` -> fallback `us-east-1`.
- If deploy/diff/remove fails with a bootstrap error, run:
  - `awsy bootstrap -c awsy.yml --region <region> --account <account-id>`
  - or `npx cdk bootstrap aws://<account-id>/<region>`
- awsy now detects this bootstrap-missing case and prints a targeted explanation with suggested commands.
- For `deploy`, awsy auto-runs bootstrap once and retries only in default bootstrap mode.
- If custom `provider.deployment` overrides are set, awsy intentionally does **not** auto-bootstrap to avoid CDKToolkit/default-bucket conflicts.
- If bootstrap itself fails because `CDKToolkit` is `DELETE_FAILED`, awsy now surfaces dedicated remediation steps (clean failed stack/resources, re-bootstrap, retry deploy).
- Important: if you set `deployRoleArn`/`cloudFormationExecutionRoleArn`, CDK uses `DefaultStackSynthesizer`, which still requires a bootstrapped environment even when `requireBootstrap` is inferred false.
- In non-interactive environments, use `awsy remove -c <config.yml> --force`.
