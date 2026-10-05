const { createApiServer } = require('./api/app');

function getPort(value = process.env.PORT || '3000') {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

if (require.main === module) {
  const port = getPort();
  const server = createApiServer();

  server.listen(port, () => {
    console.log(`CO-ED V2 API listening on port ${port}.`);
  });
}

module.exports = { getPort };
