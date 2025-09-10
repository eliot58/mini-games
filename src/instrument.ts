import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: 'https://925627151dbe979bb2aea055385c5c2d@o4507503966158848.ingest.de.sentry.io/4509991288176720',
  sendDefaultPii: true,
});
