/**
 * Rozcestník TizenBrew Background Service Proxy
 * Runs locally on Samsung Smart TV via Node.js
 * Bypasses CORS, strips/injects required streaming headers, and rewrites M3U8 playlists.
 */
'use strict';

var http = require('http');
var https = require('https');
var url = require('url');
var zlib = require('zlib');

var PORT = 3007;

function rewriteM3u8(content, baseUrl) {
  var lines = content.split(/\r?\n/);
  var result = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) {
      result.push(lines[i]);
      continue;
    }
    if (line.charAt(0) === '#') {
      // Rewrite URI="..." attributes in tags like #EXT-X-KEY or #EXT-X-MAP
      if (line.indexOf('URI="') !== -1) {
        line = line.replace(/URI="([^"]+)"/g, function(match, uriVal) {
          var resolved = url.resolve(baseUrl, uriVal);
          return 'URI="http://127.0.0.1:' + PORT + '/proxy?url=' + encodeURIComponent(resolved) + '"';
        });
      }
      result.push(line);
    } else {
      // Media segment line or child playlist line
      var resolved = url.resolve(baseUrl, line);
      result.push('http://127.0.0.1:' + PORT + '/proxy?url=' + encodeURIComponent(resolved));
    }
  }
  return result.join('\n');
}

function handleProxyRequest(targetUrl, req, res, redirectCount) {
  if (redirectCount > 5) {
    res.writeHead(502, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });
    res.end('Too many redirects');
    return;
  }

  var parsed;
  try {
    parsed = url.parse(targetUrl);
  } catch (e) {
    res.writeHead(400, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });
    res.end('Invalid target URL');
    return;
  }

  var isHttps = parsed.protocol === 'https:';
  var client = isHttps ? https : http;

  var outHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  if (req.headers['range']) {
    outHeaders['range'] = req.headers['range'];
  }
  if (req.headers['accept']) {
    outHeaders['accept'] = req.headers['accept'];
  }

  var hostname = (parsed.hostname || '').toLowerCase();
  var isYasuoyone = hostname.indexOf('yasuoyone.org') !== -1;

  if (isYasuoyone) {
    outHeaders['Origin'] = 'https://yasuoyone.org';
    outHeaders['Referer'] = 'https://yasuoyone.org/';
  }

  var options = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.path,
    method: req.method || 'GET',
    headers: outHeaders,
    rejectUnauthorized: false
  };

  var proxyReq = client.request(options, function(proxyRes) {
    // Handle HTTP Redirects
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      var nextUrl = url.resolve(targetUrl, proxyRes.headers.location);
      proxyReq.abort();
      return handleProxyRequest(nextUrl, req, res, redirectCount + 1);
    }

    var contentType = (proxyRes.headers['content-type'] || '').toLowerCase();
    var isM3u8 = contentType.indexOf('mpegurl') !== -1 ||
                 contentType.indexOf('x-mpegurl') !== -1 ||
                 (parsed.pathname && parsed.pathname.indexOf('.m3u8') !== -1) ||
                 targetUrl.indexOf('.m3u8') !== -1;

    var respHeaders = {};
    for (var k in proxyRes.headers) {
      if (Object.prototype.hasOwnProperty.call(proxyRes.headers, k)) {
        var lk = k.toLowerCase();
        if (isM3u8 && (lk === 'content-length' || lk === 'content-encoding')) {
          continue;
        }
        respHeaders[k] = proxyRes.headers[k];
      }
    }

    respHeaders['access-control-allow-origin'] = '*';
    respHeaders['access-control-allow-methods'] = 'GET, HEAD, POST, OPTIONS';
    respHeaders['access-control-allow-headers'] = '*';

    if (isM3u8) {
      respHeaders['content-type'] = 'application/vnd.apple.mpegurl';
      var chunks = [];
      var stream = proxyRes;
      var encoding = (proxyRes.headers['content-encoding'] || '').toLowerCase();

      if (encoding === 'gzip') {
        stream = proxyRes.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = proxyRes.pipe(zlib.createInflate());
      }

      stream.on('data', function(chunk) {
        chunks.push(chunk);
      });
      stream.on('end', function() {
        var body = Buffer.concat(chunks).toString('utf8');
        var rewritten = rewriteM3u8(body, targetUrl);
        respHeaders['content-length'] = Buffer.byteLength(rewritten, 'utf8');
        res.writeHead(proxyRes.statusCode, respHeaders);
        res.end(rewritten);
      });
      stream.on('error', function(err) {
        if (!res.headersSent) {
          res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
          res.end('Error decoding M3U8: ' + err.message);
        }
      });
    } else {
      res.writeHead(proxyRes.statusCode, respHeaders);
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', function(err) {
    if (!res.headersSent) {
      res.writeHead(502, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      });
      res.end('Proxy upstream error: ' + err.message);
    }
  });

  if (req.method === 'POST') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

var server = http.createServer(function(req, res) {
  // CORS Preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  var parsedReq = url.parse(req.url, true);

  // Healthcheck endpoint
  if (parsedReq.pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: PORT, timestamp: Date.now() }));
    return;
  }

  // Proxy endpoint
  if (parsedReq.pathname === '/proxy') {
    var target = parsedReq.query.url;
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing "url" query parameter');
      return;
    }
    handleProxyRequest(target, req, res, 0);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Rozcestník TV Proxy Server Running');
});

server.on('error', function(err) {
  console.error('[Rozcestník Service] Server error:', err.message);
});

server.listen(PORT, '127.0.0.1', function() {
  console.log('[Rozcestník Service] Local proxy listening on http://127.0.0.1:' + PORT);
});
