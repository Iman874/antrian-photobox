const clients = [];
let nextClientId = 1;

function generateClientId() {
    return nextClientId++;
}

function sendSSE(event, data, loc = null) {
    clients.forEach(c => {
        try {
            if (!loc || c.location === loc || c.location === 'All') {
                c.res.write(`event: ${event}\n`);
                c.res.write(`data: ${JSON.stringify(data)}\n\n`);
            }
        } catch (e) {
            // ignore dead connection
        }
    });
}

function addClient(client) {
    clients.push(client);
}

function removeClient(id) {
    const index = clients.findIndex(c => c.id === id);
    if (index !== -1) {
        clients.splice(index, 1);
    }
}

// Heartbeat every 30 seconds
setInterval(() => {
    clients.forEach(c => {
        try { c.res.write(': keepalive\n\n'); } catch (e) { /* ignore */ }
    });
}, 30000);

module.exports = {
    clients,
    sendSSE,
    addClient,
    removeClient,
    generateClientId
};
