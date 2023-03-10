/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @oncall react_native
 */

'use strict';

import type {Module} from '../../types.flow';

const {isBytecodeModule, wrapModule} = require('./bytecode');

function processBytecodeModules(
  modules: $ReadOnlyArray<Module<>>,
  {
    filter = () => true,
    createModuleId,
    dev,
    includeAsyncPaths,
    projectRoot,
    serverRoot,
  }: $ReadOnly<{
    filter?: (module: Module<>) => boolean,
    createModuleId: string => number,
    dev: boolean,
    includeAsyncPaths: boolean,
    projectRoot: string,
    serverRoot: string,
  }>,
): $ReadOnlyArray<[Module<>, Array<Buffer>]> {
  return [...modules]
    .filter(isBytecodeModule)
    .filter(filter)
    .map((module: Module<>) => [
      module,
      wrapModule(module, {
        createModuleId,
        dev,
        includeAsyncPaths,
        projectRoot,
        serverRoot,
      }),
    ]);
}

module.exports = processBytecodeModules;
