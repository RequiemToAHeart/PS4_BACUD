const jwt = require('jsonwebtoken');
const { grpc, rpcError } = require('./grpc');

const secret = process.env.JWT_SECRET || 'development-only-change-this-long-secret-now';
const options = { issuer: 'st-dism-enrollment', audience: 'enrollment-app', algorithms: ['HS256'] };

function sign(user) {
  return jwt.sign({ sub: user.id, name: user.name, role: user.role }, secret, {
    issuer: options.issuer,
    audience: options.audience,
    algorithm: 'HS256',
    expiresIn: '30m',
    jwtid: require('node:crypto').randomUUID()
  });
}

function verify(token) {
  return jwt.verify(token, secret, options);
}

function authorized(call, role) {
  const authorization = call.metadata.get('authorization')[0];
  const match = typeof authorization === 'string' && /^Bearer (.+)$/.exec(authorization);
  if (!match) throw rpcError(grpc.status.UNAUTHENTICATED, 'Please log in.');
  let user;
  try {
    user = verify(match[1]);
  } catch {
    throw rpcError(grpc.status.UNAUTHENTICATED, 'Your session has expired. Please log in again.');
  }
  if (role && user.role !== role) throw rpcError(grpc.status.PERMISSION_DENIED, 'Your account cannot use this feature.');
  return user;
}

function handle(callback, task) {
  try {
    callback(null, task());
  } catch (error) {
    callback(error);
  }
}

module.exports = { sign, verify, authorized, handle };
