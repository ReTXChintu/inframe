// pm2 process file for the server:  pm2 startOrReload ecosystem.config.cjs --update-env
//
//   inframe         — the API + web app + realtime (one process)
//   inframe-worker  — background work: storing uploads in Drive/MEGA, thumbnails,
//                     video posters, face detection + matching, folder sync.
//                     Scale with INFRAME_WORKERS (default 2); they share the job queue.
//
// Both read the repo-root .env. Workers must run on the same machine as the
// API: uploads wait for them in the spool directory (SPOOL_DIR).
const workers = Number(process.env.INFRAME_WORKERS || 2);

module.exports = {
  apps: [
    {
      name: "inframe",
      cwd: __dirname,
      script: "apps/server/dist/index.js",
      max_memory_restart: "1500M",
      time: true,
      kill_timeout: 15000,
    },
    {
      name: "inframe-worker",
      cwd: __dirname,
      script: "apps/server/dist/worker.js",
      instances: workers,
      exec_mode: "fork",
      max_memory_restart: "1500M",
      time: true,
      // Let in-flight jobs (an upload to MEGA, a face scan) finish before a restart.
      kill_timeout: 60000,
    },
  ],
};
