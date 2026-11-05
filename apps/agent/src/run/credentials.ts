import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";

/** STS AssumeRole with the connection's long-lived keys, injected so tests don't reach AWS. */
export type AssumeRole = (input: {
  roleArn: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionName: string;
  durationSeconds: number;
}) => Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}>;

/** The spec's 1-hour credentials. */
const AWS_SECONDS = 3600;

export const stsAssumeRole: AssumeRole = async (input) => {
  const sts = new STSClient({
    // STS answers in every region; the global endpoint is in us-east-1.
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  });
  try {
    const { Credentials: c } = await sts.send(
      new AssumeRoleCommand({
        RoleArn: input.roleArn,
        RoleSessionName: input.sessionName,
        DurationSeconds: input.durationSeconds,
      }),
    );
    if (
      !c?.AccessKeyId ||
      !c.SecretAccessKey ||
      !c.SessionToken ||
      !c.Expiration
    ) {
      throw new Error("AssumeRole returned no credentials");
    }
    return {
      accessKeyId: c.AccessKeyId,
      secretAccessKey: c.SecretAccessKey,
      sessionToken: c.SessionToken,
      expiration: c.Expiration,
    };
  } finally {
    sts.destroy();
  }
};

/**
 * What a run gets for a granted connection's stored secret. Every type but
 * `aws` gets it as stored. For `aws` the worker assumes the connection's role
 * and hands out only the 1-hour keys, shaped for `credential_process`
 * (`Version` as a string: the socket's secrets are strings; `dlh-credential`
 * prints it as the number 1).
 */
export async function secretForRun(
  type: string,
  stored: Record<string, string>,
  runId: string,
  assumeRole: AssumeRole,
): Promise<Record<string, string>> {
  if (type !== "aws") return stored;
  const c = await assumeRole({
    roleArn: stored.role_arn ?? "",
    accessKeyId: stored.access_key_id ?? "",
    secretAccessKey: stored.secret_access_key ?? "",
    sessionName: `dlh-run-${runId}`,
    durationSeconds: AWS_SECONDS,
  });
  return {
    Version: "1",
    AccessKeyId: c.accessKeyId,
    SecretAccessKey: c.secretAccessKey,
    SessionToken: c.sessionToken,
    Expiration: c.expiration.toISOString(),
  };
}
