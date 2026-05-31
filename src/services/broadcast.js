const { sendSSE } = require('./sse');
const { getStats } = require('./stats');

async function broadcastAll(studio_location) {
    sendSSE('update_stats', await getStats(studio_location), studio_location);
    const main = await getStats('Studio Utama');
    const youth = await getStats('Youth Center');
    sendSSE('update_all_stats', { 'Studio Utama': main, 'Youth Center': youth });
}

module.exports = {
    broadcastAll
};
