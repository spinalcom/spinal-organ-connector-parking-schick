const path = require('path');

require('dotenv').config({ override: true, path: path.resolve(__dirname, '.env') });

const hub_port = process.env.SPINALHUB_PORT;

module.exports = {
  apps: [
    {
      name: `spinal-organ-connector-parking-schick-${hub_port}`,
      script: 'index.js',
      cwd: '.',
    },
  ],
};
