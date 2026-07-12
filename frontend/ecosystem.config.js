// PM2 config for the Hoodsea frontend.
// Cluster mode runs a few Next workers sharing port 3040 so traffic is spread
// across cores. Instance count is kept modest because this VPS is shared.
module.exports = {
  apps: [
    {
      name: "hoodsea",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3040",
      cwd: "/root/hoodsea/frontend",
      instances: 2,
      exec_mode: "cluster",
      max_memory_restart: "1G",
      env: { NODE_ENV: "production", PORT: "3040" },
    },
  ],
};
