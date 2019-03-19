/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

import type {IndexMap, IndexMapSection, MetroSourceMap} from './source-map';

/**
 * Builds a source-mapped bundle by concatenating strings and their
 * corresponding source maps (if any).
 *
 * Usage:
 *
 * const builder = new BundleBuilder('bundle.js');
 * builder
 *   .append('foo\n', fooMap)
 *   .append('bar\n')
 *   // ...
 * const code = builder.getCode();
 * const map = builder.getMap();
 */
class BundleBuilder {
  _file: string;
  _sections: Array<IndexMapSection>;
  _line: number;
  _column: number;
  _code: string;

  constructor(file: string) {
    this._file = file;
    this._sections = [];
    this._line = 0;
    this._column = 0;
    this._code = '';
  }

  append(code: string, map: ?MetroSourceMap): this {
    const {lineBreaks, lastLineColumns} = measureString(code);
    if (map) {
      this._sections.push({
        map,
        offset: {column: this._column, line: this._line},
      });
    }
    this._line = this._line + lineBreaks;
    if (lineBreaks > 0) {
      this._column = lastLineColumns;
    } else {
      this._column = this._column + lastLineColumns;
    }
    this._code = this._code + code;
    return this;
  }

  getMap(): MetroSourceMap {
    return createIndexMap(this._file, this._sections);
  }

  getCode(): string {
    return this._code;
  }
}

const reLineBreak = /\r\n|\r|\n/g;

function measureString(
  str: string,
): {|lineBreaks: number, lastLineColumns: number|} {
  let lineBreaks = 0;
  let match;
  let lastLineStart = 0;
  while ((match = reLineBreak.exec(str))) {
    ++lineBreaks;
    lastLineStart = match.index + match[0].length;
  }
  const lastLineColumns = str.length - lastLineStart;
  return {lineBreaks, lastLineColumns};
}

function createIndexMap(
  file: string,
  sections: Array<IndexMapSection>,
): IndexMap {
  return {
    version: 3,
    file,
    sections,
  };
}

module.exports = {BundleBuilder, createIndexMap};
