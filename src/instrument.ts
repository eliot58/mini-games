import * as Sentry from "@sentry/nestjs"

Sentry.init({
  dsn: "https://b6828dee5b3cd083ff2746406ee13eff@o4507503966158848.ingest.de.sentry.io/4509545170337872",

  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
});