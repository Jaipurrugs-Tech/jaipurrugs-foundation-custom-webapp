// PM2 settings for survey.jaipurrugs.org (see docs/deploy.md).
// Apply changes with: pm2 delete jaipurrugs-foundation && pm2 start ~/jrf/current/ecosystem.config.cjs && pm2 save
const home = process.env.HOME;

module.exports = {
  apps: [
    {
      name: "jaipurrugs-foundation",
      // A symlink to the live release; scripts/deploy.sh repoints it, then restarts.
      cwd: `${home}/jrf/current`,
      script: "npm",
      args: "start -- -p 3002",
      exec_mode: "fork",
      instances: 1,
      // Crash-loop protection: a start that dies within 30s counts as unstable, each
      // retry waits longer (exponential back-off), and PM2 gives up after 10 in a row
      // instead of restarting hundreds of times.
      min_uptime: "30s",
      max_restarts: 10,
      exp_backoff_restart_delay: 2000,
      // Restart if memory runs away (normal use is ~300 MB).
      max_memory_restart: "1500M",
      kill_timeout: 10000,
      time: true,
      env: { NODE_ENV: "production" },
    },
  ],
};
