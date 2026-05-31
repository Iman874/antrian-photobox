const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// 1. First, load the default .env if it exists to get the baseline NODE_ENV
// Using path.resolve(__dirname, '../../') ensures it always points to the project root folder
// even if process.cwd() is overridden by cPanel/Passenger at runtime.
const rootDir = path.resolve(__dirname, '../../');
const defaultEnvPath = path.resolve(rootDir, '.env');
if (fs.existsSync(defaultEnvPath)) {
    dotenv.config({ path: defaultEnvPath, override: true });
}

// 2. Now determine the active environment
const nodeEnv = process.env.NODE_ENV || 'development';
console.log(`[ENV] Active Environment: ${nodeEnv.toUpperCase()}`);

// 3. Load specific files in priority order (overriding previous values)
const envFiles = [
    `.env.${nodeEnv}`,
    `.env.${nodeEnv}.local`,
    `.env.local`
];

envFiles.forEach(file => {
    const envPath = path.resolve(rootDir, file);
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath, override: true });
        console.log(`[ENV] Loaded overrides from: ${file}`);
    }
});
