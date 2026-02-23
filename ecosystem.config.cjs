module.exports = {
  apps: [
    {
      name: "bulk-api",
      script: "src/index.js",
      instances: 1,
      autorestart: true,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "worker-ingestion",
      script: "src/workers/ingestionRunner.js",
      instances: 1,
      autorestart: true,
      max_memory_restart: "400M"
    },
    {
      name: "worker-validation",
      script: "src/workers/validationWorker.js",
      instances: 2,
      autorestart: true,
      max_memory_restart: "400M"
    },
    {
      name: "worker-delivery",
      script: "src/workers/deliveryWorker.js",
      instances: 2,
      autorestart: true,
      max_memory_restart: "400M"
    },
    {
      name: "worker-outbox-replay",
      script: "src/workers/outboxReplayWorker.js",
      cron_restart: "*/10 * * * *",
      autorestart: true,
      max_memory_restart: "300M"
    },
    {
      name: "scheduler",
      script: "src/workers/schedulerWorker.js",
      cron_restart: "*/15 * * * *",
      autorestart: false,
      max_memory_restart: "200M",
      env: {
        SCHEDULE_INTERVAL_MINUTES: "15",
        MAX_CONCURRENT_RUNS: "1"
      }
    },
    {
      name: "report-scheduler",
      script: "src/workers/reportSchedulerWorker.js",
      cron_restart: "0 */2 * * *",
      autorestart: false,
      max_memory_restart: "200M"
    },
    {
      name: "hourly-publish",
      script: "src/workers/hourlyPublishWorker.js",
      cron_restart: "0 * * * *",
      autorestart: false,
      max_memory_restart: "200M"
    }
  ]
};
