const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// 1. First, load the default .env if it exists to get the baseline NODE_ENV
const defaultEnvPath = path.resolve(__dirname, '.env');
if (fs.existsSync(defaultEnvPath)) {
    dotenv.config({ path: defaultEnvPath });
}

// 2. Now determine the active environment
const nodeEnv = process.env.NODE_ENV || 'development';
console.log(`[ENV] Active Environment: ${nodeEnv.toUpperCase()}`);

// 3. Load specific files in priority order (overriding previous values)
// Priority: Specific env file (e.g. .env.development or .env.production) 
// then local overrides (.env.local or .env.development.local)
const envFiles = [
    `.env.${nodeEnv}`,
    `.env.${nodeEnv}.local`,
    `.env.local`
];

envFiles.forEach(file => {
    const envPath = path.resolve(__dirname, file);
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath, override: true });
        console.log(`[ENV] Loaded overrides from: ${file}`);
    }
});
