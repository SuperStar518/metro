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

const {isJsModule, wrapModule} = require('./js');

function processModules(
  modules: $ReadOnlyArray<Module<>>,
  {
    filter = () => true,
    createModuleId,
    dev,
    projectRoot,
  }: {
    +filter?: (module: Module<>) => boolean,
    +createModuleId: string => number,
    +dev: boolean,
    +projectRoot: string,
  },
): $ReadOnlyArray<[Module<>, string]> {
  return [...modules]
    .filter(isJsModule)
    .filter(filter)
    .map((module: Module<>) => [
      module,
      wrapModule(module, {
        createModuleId,
        dev,
        projectRoot,
      }),
    ]);
}

module.exports = processModules;
