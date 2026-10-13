// Deployment configuration. These values are public by design (they ship to the
// browser); secrets never belong here. Keep in sync with infra/serverless.yml outputs.
export const config = {
  api: "https://9hi9hsm4n1.execute-api.us-east-1.amazonaws.com",
  cognito: "https://pixiset-gallery-674948790853.auth.us-east-1.amazoncognito.com",
  clientId: "3fleqt4pgl9a7hr5snddok64qs",
};
