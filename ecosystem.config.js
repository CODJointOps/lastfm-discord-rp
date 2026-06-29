// PM2 process config. Uses __dirname so cwd is always the repo root,
// which main.js relies on (it reads "config.json" by relative path).
module.exports = {
  apps: [
    {
      name: "lastfm-discord-rp",
      script: "main.js",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      watch: false,
      out_file: __dirname + "/logs/out.log",
      error_file: __dirname + "/logs/error.log",
      time: true,
    },
  ],
};
