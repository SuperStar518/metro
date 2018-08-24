/**
 * Copyright (c) 2013-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

const Router = require('router');
const Server = require('metro/src/Server');

const fs = require('fs');
const graphRoutes = require('./api/graphRoutes');
const metro = require('metro');

const {bundlerHistory, startRecordingHistory} = require('./metroHistory');
const {Terminal} = require('metro-core');
const {parse} = require('url');

import type {Graph} from 'metro/src/DeltaBundler';

const router = Router();
const terminal = new Terminal(process.stdout);

let metroServer: Server;

router.get('/', (req, res) => {
  const status = 'Launching visualizer';
  terminal.status(status);

  res.writeHead(200, {'Content-Type': 'text/html'});
  res.write(fs.readFileSync(require.resolve('metro-visualizer/index.html')));
  res.end();

  terminal.status(`${status}, done.`);
  terminal.persistStatus();
});

router.use(function query(req, res, next) {
  req.query = req.url.includes('?') ? parse(req.url, true).query : {};
  next();
});

router.use('/', (err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send(err.message);
  next();
});

router.use('/graph', async (req, res, next) => {
  await getGraph(req.query.hash)
    .then(metroGraph => graphRoutes(metroGraph)(req, res, next))
    .catch(error => {
      res.writeHead(500, {'Content-Type': 'text/plain'});
      res.write((error && error.stack) || error);
      res.end();
    });
});

router.get('/bundles', async function(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.write(JSON.stringify(bundlerHistory));
  res.end();
});

router.use('/bundle.js', async (req, res, next) => {
  const status = 'Bundling visualizer app';

  const options = {
    dev: true,
    entry: './src/index.js',
    minify: false,
    platform: 'web',
  };

  const config = await metro.loadConfig({
    config: require.resolve('./metro.config.js'),
  });

  await metro
    .runBuild(config, options)
    .then((val: {code: string, map: string}) => {
      terminal.status(`${status}... serving`);

      res.writeHead(200, {'Content-Type': 'text/javascript'});
      res.write(val.code);
      res.end();

      terminal.status(`${status}, done.`);
      terminal.persistStatus();
    })
    .catch(error => {
      terminal.log(error);
      terminal.status(`${status}, failed.`);
      terminal.persistStatus();
    });
});

async function getGraph(optionsHash: string): Promise<Graph<>> {
  const status = "Getting last bundle's graph";

  terminal.status(`${status}... fetching from Metro`);
  const graph = metroServer.getGraphs().get(optionsHash);

  if (graph == null) {
    terminal.status(`${status}, failed.`);
    terminal.persistStatus();

    throw new Error('A graph with the given hash was not found');
  }

  terminal.status(`${status}, done.`);

  return graph.then(graphInfo => graphInfo.graph);
}

function initRouter(server: Server) {
  metroServer = server;
  startRecordingHistory(metroServer._logger);
  return router;
}

module.exports = initRouter;
