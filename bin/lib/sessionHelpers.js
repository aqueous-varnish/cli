const os = require('os');
const fs = require('fs');
const path = require('path');
const util = require('util');
const devcert = require('devcert');
const Constants = require('../Constants');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const open = require('open');
const url = require('url');
const axios = require('axios');

const _storeCurrentSession = async (env, sessionDetails) => {
  const allSessions = fetchAllSessions() || {};
  allSessions[env] = sessionDetails;
  const dir = `${os.homedir()}/.aqueous-varnish/`;
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir); }
  const sessionDetailsAsJSON = JSON.stringify(allSessions);
  const newFile = path.join(dir, 'sessions.json');
  await util.promisify(fs.writeFile)(newFile, sessionDetailsAsJSON, 'utf8');
  return sessionDetails;
};

const fetchAllSessions = () => {
  try {
    const file = `${os.homedir()}/.aqueous-varnish/sessions.json`;
    const contents = fs.readFileSync(file, 'utf8');
    return JSON.parse(contents);
  } catch(e) {
    return null;
  }
};

const fetchCurrentSession = (AQVS) => {
  const sessions = fetchAllSessions();
  if (sessions) return sessions[AQVS.env];
  return null;
};

const requestSignedNonce = async (AQVS) => {
  return attemptInMetamask(AQVS, 'sign-nonce', {}, params => {
    const { requestId, publicAddress, signature } = params;
    const ok = !!requestId && !!publicAddress && !!signature;
    return {
      status: ok ? "ok" : "error",
      results: { requestId, publicAddress, signature }
    };
  });
};

const attemptInMetamask = async (AQVS, operation, args, callback) => {
  callback = (callback || (results => {
    return { status: "ok", results };
  }));

  return new Promise(async (resolve, reject) => {
    // TODO: Notify user we may need a SSL cert
    const ssl = await devcert.certificateFor(Constants.CLI_HOST, {
      getCaPath: true,
      getCaBuffer: true
    });

    let timeout;
    const attempt = uuidv4();
    const server = https.createServer(ssl, async (req, res) => {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname == '/') {
        res.writeHead(200, { 'content-type': 'text/html' })
        fs.createReadStream(Constants.BROWSER_APP_INDEX).pipe(res);
      } else if (parsed.pathname.startsWith('/success')) {
        if (timeout) clearTimeout(timeout);
        const { attemptId } = parsed.query;

        let data = {};
        if (req.method === 'POST') {
          const buffers = [];
          for await (const chunk of req) {
            buffers.push(chunk);
          }
          data = JSON.parse(Buffer.concat(buffers).toString());
        }

        const { status, results } = callback(Object.assign({ results: data }, parsed.query));
        const success = ((attemptId === attempt) && (status === "ok"));
        if (success) {
          res.writeHead(204);
          res.end();
        } else {
          res.writeHead(401);
          res.end();
        }
        req.connection.end();
        req.connection.destroy();
        server.close();
        success ? resolve(results) : reject(new Error('failure'));
      } else {
        // Assume it's a React dep
        // TODO: CSS
        res.writeHead(200, { 'content-type': 'text/javascript' })
        fs.createReadStream(`./browser/build${parsed.pathname}`).pipe(res);
      }
    }).listen(Constants.NONCE_SIGNER_PORT);

    const extraParams = Object.keys(args || {}).reduce((acc, argKey) => {
      return `${acc}&${argKey}=${args[argKey]}`;
    }, ``);

    await open(`https://${Constants.CLI_HOST}:${Constants.NONCE_SIGNER_PORT}/?operation=${operation}&attemptId=${attempt}&env=${AQVS.env}${extraParams}`);

    timeout = setTimeout(function() {
      server.close();
      reject(new Error('timeout'));
    }, Constants.NONCE_SIGNER_TIMEOUT);
  });
};

const promptUserToMintSpace = async (
  proxy,
  publicAddress,
  initialSupply,
  storageSpaceAsBytes,
  accessCostAsWei
) => {
  return attemptInMetamask(proxy, 'mint-space', {
    operator: publicAddress,
    initialSupply,
    storageSpaceAsBytes,
    accessCostAsWei
  }, params => {
    const { spaceId } = params;
    const ok = !!spaceId;
    return {
      status: ok ? "ok" : "error",
      results: { spaceId }
    };
  });
};

const validateOrInitiateSession = async (AQVS) => {
  const gateway = AQVS.ENVIRONMENTS[AQVS.env].gateway;
  const currentSession = await testSession(AQVS, fetchCurrentSession(AQVS));
  if (currentSession) return currentSession;

  const { requestId, publicAddress, signature } = await requestSignedNonce(AQVS);
  const response = await axios.get(
    `${gateway}/session?requestId=${requestId}&publicAddress=${publicAddress}&signature=${signature}`,
    { withCredentials: true }
  );
  return await _storeCurrentSession(AQVS.env, {
    cookie: (response.headers['set-cookie'] || [])[0],
    publicAddress: response.data.publicAddress
  });
};

const deleteSession = async (AQVS) => {
  const currentSession = await testSession(AQVS, fetchCurrentSession(AQVS));
  if (!currentSession) return true;
  try {
    await AQVS.sessions.flushSession(currentSession.cookie);
  } catch(e) {}
  await _storeCurrentSession(AQVS.env, {
    cookie: null,
    publicAddress: null
  });
  return true;
};

const testSession = async (AQVS, currentSession) => {
  if (!currentSession || !currentSession.cookie) return false;
  try {
    const response = await AQVS.sessions.currentSession(currentSession.cookie);
    if (response.status !== 200) throw new Error("session_expired");
    const { publicAddress } = await response.json();
    return await _storeCurrentSession(AQVS.env, {
      cookie: response.headers.get('set-cookie'),
      publicAddress
    });
  } catch(e) {
    await _storeCurrentSession(AQVS.env, {
      cookie: null,
      publicAddress: null
    });
    return false;
  }
};

module.exports = {
  testSession,
  fetchCurrentSession,
  deleteSession,
  validateOrInitiateSession,
  promptUserToMintSpace,
  attemptInMetamask
};
