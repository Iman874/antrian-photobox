module.exports = {
  apps: [
    {
      name: 'antrian-photobox',
      script: 'server.js',
      // Mengarahkan Working Directory PM2 agar dinamis menunjuk ke lokasi file config ini berada
      cwd: __dirname, // 👈 Menggunakan __dirname agar dinamis, tidak hardcoded, dan portabel di komputer mana pun!
      instances: 1, // Untuk lokal Windows tetap 1 agar port 3000 stabil tanpa kendala socket cluster OS Windows
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
