const fs = require('node:fs');
const path = require('node:path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const definition = protoLoader.loadSync(path.join(__dirname, '..', 'proto', 'enrollment.proto'), {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});
const services = grpc.loadPackageDefinition(definition).enrollment;

function credentials() {
  if (process.env.GRPC_TLS_CA) {
    return grpc.credentials.createSsl(fs.readFileSync(process.env.GRPC_TLS_CA));
  }
  return grpc.credentials.createInsecure();
}

function serverCredentials() {
  if (process.env.GRPC_TLS_CERT && process.env.GRPC_TLS_KEY) {
    return grpc.ServerCredentials.createSsl(null, [{
      cert_chain: fs.readFileSync(process.env.GRPC_TLS_CERT),
      private_key: fs.readFileSync(process.env.GRPC_TLS_KEY)
    }]);
  }
  return grpc.ServerCredentials.createInsecure();
}

function client(name, address) {
  return new services[name](address, credentials());
}

function call(clientInstance, method, payload = {}, token = '') {
  const metadata = new grpc.Metadata();
  if (token) metadata.set('authorization', `Bearer ${token}`);
  const deadline = new Date(Date.now() + 1500);
  return new Promise((resolve, reject) => {
    clientInstance[method](payload, metadata, { deadline }, (error, reply) => {
      if (error) reject(error);
      else resolve(reply);
    });
  });
}

function serve(name, implementation, port) {
  const server = new grpc.Server();
  server.addService(services[name].service, implementation);
  server.bindAsync(`0.0.0.0:${port}`, serverCredentials(), (error, boundPort) => {
    if (error) throw error;
    process.stdout.write(`${name} listening on ${boundPort}\n`);
  });
  return server;
}

function rpcError(code, message) {
  return Object.assign(new Error(message), { code });
}

module.exports = { grpc, client, call, serve, rpcError };
