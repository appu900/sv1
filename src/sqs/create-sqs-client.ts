import { SQSClient } from '@aws-sdk/client-sqs';

export function regionFromSqsQueueUrl(queueUrl: string): string | undefined {
  try {
    const host = new URL(queueUrl).hostname;
    const match = /^sqs\.([a-z0-9-]+)\.amazonaws\.com$/i.exec(host);
    return match?.[1];
  } catch {
    return undefined;
  }
}

export function createSqsClient(queueUrl: string): SQSClient {
  const region = regionFromSqsQueueUrl(queueUrl) ?? process.env.AWS_REGION;
  if (!region) {
    throw new Error(
      'Could not resolve SQS region from SQS_URL or AWS_REGION',
    );
  }

  return new SQSClient({
    region,
    maxAttempts: 3,
  });
}
