/**
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails oncall+javascript_foundation
 * @flow (won't like this)
 * @format
 */

'use strict';

// This is a temporary migration bridge to switch between babel 6 and 7

const IS_BABEL7 = true; // process.env.BABEL_VERSION === '7';

// ## Babel 6 stuff

const babelCore6 = require('babel-core');
const babelGenerate6 = require('babel-generator').default;
const babelTemplate6 = require('babel-template');
const babelTraverse6 = require('babel-core').traverse;
const babelTypes6 = require('babel-core').types;
const babylon6 = require('babylon');

const externalHelpersPlugin6 = require('babel-plugin-external-helpers');
const inlineRequiresPlugin6 = require('babel-preset-fbjs/plugins/inline-requires');
const makeHMRConfig6 = require('babel-preset-react-native/configs/hmr');
const resolvePlugins6 = require('babel-preset-react-native/lib/resolvePlugins');
// register has side effects so don't include by default (only used in a test)
const getBabelRegisterConfig6 = () => require('metro-babel-register').config;
// load given preset as a babel6 preset

// ## Babel 7 stuff

const babelCore7 = require('@babel/core');
const babelGenerate7 = require('@babel/generator').default;
const babelTemplate7 = require('@babel/template').default;
const babelTraverse7 = require('@babel/traverse').default;
const babelTypes7 = require('@babel/types');
const babylon7 = require('metro-babylon7');

const externalHelpersPlugin7 = require('babel-plugin-external-helpers');
const inlineRequiresPlugin7 = require('babel-preset-fbjs/plugins/inline-requires');
const makeHMRConfig7 = makeMakeHMRConfig7();
function resolvePlugins7(plugins: Array<any>) {
  /**
   * from: babel-preset-react-native/lib/resolvePlugins
   * "Ported" to Babel 7
   *
   * Manually resolve all default Babel plugins.
   * `babel.transform` will attempt to resolve all base plugins relative to
   * the file it's compiling. This makes sure that we're using the plugins
   * installed in the react-native package.
   */
  type ModuleES6 = {__esModule?: boolean, default?: {}};
  /* $FlowFixMe(>=0.70.0 site=react_native_fb) This comment suppresses an
   * error found when Flow v0.70 was deployed. To see the error delete this
   * comment and run Flow. */
  return plugins.map(plugin => {
    // Normalise plugin to an array.
    plugin = Array.isArray(plugin) ? plugin : [plugin];
    // Only resolve the plugin if it's a string reference.
    if (typeof plugin[0] === 'string') {
      // $FlowFixMe TODO t26372934 plugin require
      const required: ModuleES6 | {} = require('@babel/plugin-' + plugin[0]);
      // es6 import default?
      // $FlowFixMe should properly type this plugin structure
      plugin[0] = required.__esModule ? required.default : required;
    }
    return plugin;
  });
}

module.exports = {
  version: IS_BABEL7 ? 7 : 6,

  // need to abstract the transform* funcs here since their name changed
  transformSync: IS_BABEL7 ? babelCore7.transformSync : babelCore6.transform,
  transformFileSync: IS_BABEL7
    ? babelCore7.transformFileSync
    : babelCore6.transformFile,
  transformFromAstSync: IS_BABEL7
    ? babelCore7.transformFromAstSync
    : babelCore6.transformFromAst,

  babelGenerate: IS_BABEL7 ? babelGenerate7 : babelGenerate6,
  babelTemplate: IS_BABEL7 ? babelTemplate7 : babelTemplate6,
  babelTraverse: IS_BABEL7 ? babelTraverse7 : babelTraverse6,
  babelTypes: IS_BABEL7 ? babelTypes7 : babelTypes6,
  getBabelRegisterConfig: IS_BABEL7
    ? getBabelRegisterConfig7
    : getBabelRegisterConfig6,
  babylon: IS_BABEL7 ? babylon7 : babylon6,

  externalHelpersPlugin: IS_BABEL7
    ? externalHelpersPlugin7
    : externalHelpersPlugin6,
  inlineRequiresPlugin: IS_BABEL7
    ? inlineRequiresPlugin7
    : inlineRequiresPlugin6,
  makeHMRConfig: IS_BABEL7 ? makeHMRConfig7 : makeHMRConfig6,
  resolvePlugins: IS_BABEL7 ? resolvePlugins7 : resolvePlugins6,
  getPreset,
};

function makeMakeHMRConfig7() {
  // from: babel-preset-react-native/configs/hmr
  /**
   * Copyright (c) 2015-present, Facebook, Inc.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   */
  'use strict';

  var path = require('path');
  var hmrTransform = 'react-transform-hmr/lib/index.js';
  var transformPath = require.resolve(hmrTransform);

  return function(options: mixed, filename?: string) {
    var transform = filename
      ? './' + path.relative(path.dirname(filename), transformPath) // packager can't handle absolute paths
      : hmrTransform;

    // Fix the module path to use '/' on Windows.
    if (path.sep === '\\') {
      transform = transform.replace(/\\/g, '/');
    }

    return {
      plugins: [
        [
          require('metro-babel7-plugin-react-transform'),
          {
            transforms: [
              {
                transform,
                imports: ['react'],
                locals: ['module'],
              },
            ],
          },
        ],
      ],
    };
  };
}

function getPreset(name: string) {
  if (!/^(?:@babel\/|babel-)preset-/.test(name)) {
    try {
      name = require.resolve(`babel-preset-${name}`);
    } catch (error) {
      if (error && error.conde === 'MODULE_NOT_FOUND') {
        name = require.resolve(`@babel/preset-${name}`);
      }
    }
  }
  //$FlowFixMe: TODO t26372934 this has to be dynamic
  return require(name);
}

function getBabelRegisterConfig7() {
  // from: metro/packages/metro-babel-register/babel-register.js
  // (dont use babel-register anymore, it obsoleted with babel 7)

  /**
   * Copyright (c) 2015-present, Facebook, Inc.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *
   * @format
   */
  'use strict';

  require('metro-babel-register/src/node-polyfills');

  var _only = [];

  const PLUGINS = [
    'transform-flow-strip-types',
    'proposal-object-rest-spread',
    'proposal-class-properties',
  ];

  function config(onlyList: Array<string>) {
    /* $FlowFixMe(>=0.70.0 site=react_native_fb) This comment suppresses an
     * error found when Flow v0.70 was deployed. To see the error delete this
     * comment and run Flow. */
    _only = _only.concat(onlyList);
    return {
      presets: [],
      /* $FlowFixMe(>=0.70.0 site=react_native_fb) This comment suppresses an
       * error found when Flow v0.70 was deployed. To see the error delete
       * this comment and run Flow. */
      plugins: PLUGINS.map(pluginName =>
        // $FlowFixMe TODO t26372934 plugin require
        require(`@babel/plugin-${pluginName}`),
      ),
      only: _only,
      retainLines: true,
      sourceMaps: 'inline',
      babelrc: false,
    };
  }

  return config;
}
