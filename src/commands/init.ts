import fs from "node:fs";
import path from "node:path";

const starter = `service: my-service
provider:
  region: us-east-1
  stage: dev
  s3:
    # Optional role used for S3 object cleanup when autoDeleteObjects=true
    cleanupRoleArn: arn:aws:iam::123456789012:role/MyS3CleanupRole

functions:
  hello:
    handler: src/handlers/hello.handler
    runtime: nodejs20.x
    timeout: 10
    memorySize: 256
    environment:
      STAGE: dev
    events:
      http:
        - method: GET
          path: /hello
      rest:
        - method: GET
          path: /hello-rest
      sqs:
        - queue: ref:jobs
          batchSize: 10

storage:
  s3:
    uploads:
      versioned: true
      autoDeleteObjects: false
  dynamodb:
    users:
      partitionKey:
        name: pk
        type: string
      billingMode: PAY_PER_REQUEST
      stream: NEW_AND_OLD_IMAGES

messaging:
  sqs:
    jobs:
      visibilityTimeout: 30
  sns:
    events:
      subscriptions:
        - type: sqs
          target: jobs

iam:
  statements:
    readUsersTable:
      actions: [dynamodb:GetItem, dynamodb:Query]
      resources: [ref:users]
`;

export function runInit(configPath: string): void {
  if (fs.existsSync(configPath)) {
    throw new Error(`Config file already exists: ${configPath}`);
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, starter, "utf8");
  process.stdout.write(`Created starter config at ${configPath}\n`);
}
