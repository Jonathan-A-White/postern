// tests/support/build-origin.ts — an origin of the test's own in front of the previewed dist/: every request goes to the
// preview as it came, except sw.js, which carries one more comment line naming the build the test says is up. The browser
// fetches a service worker's script for an update check itself, where Playwright's context.route does not see it (only the
// first install's fetch is routed), so a "newer build" made with route() was only ever the unmodified file, and the app's own
// check at start-up found it. Here every fetch of sw.js, install and update alike, is answered by the build the test names.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface BuildOrigin {
  /** The origin the page opens, e.g. http://127.0.0.1:41233. */
  url: string;
  /** The build number sw.js is served with from now on. */
  setBuild(build: number): void;
  close(): Promise<void>;
}

export async function startBuildOrigin(previewUrl: string, firstBuild = 1): Promise<BuildOrigin> {
  let build = firstBuild;
  const target = new URL(previewUrl);
  const server = http.createServer((req, res) => {
    const forward = http.request(
      { host: target.hostname, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, host: target.host, 'accept-encoding': 'identity' } },
      (answer) => {
        if (!req.url || new URL(req.url, previewUrl).pathname !== '/sw.js') {
          res.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        answer.on('data', (chunk: Buffer) => chunks.push(chunk));
        answer.on('end', () => {
          const body = Buffer.concat([...chunks, Buffer.from(`\n// build ${build}\n`)]);
          const headers = { ...answer.headers, 'cache-control': 'no-store', 'content-length': String(body.length) };
          delete headers.etag;
          delete headers['last-modified'];
          res.writeHead(answer.statusCode ?? 502, headers);
          res.end(body);
        });
      },
    );
    forward.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(forward);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    setBuild(next) {
      build = next;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
