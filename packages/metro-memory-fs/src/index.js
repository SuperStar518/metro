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

/* eslint-disable no-bitwise */

// $FlowFixMe: not defined by Flow
const constants = require('constants');
const stream = require('stream');

const {EventEmitter} = require('events');

type NodeBase = {|
  gid: number,
  id: number,
  mode: number,
  uid: number,
  watchers: Array<NodeWatcher>,
|};

type DirectoryNode = {|
  ...NodeBase,
  type: 'directory',
  entries: Map<string, EntityNode>,
|};

type FileNode = {|
  ...NodeBase,
  type: 'file',
  content: Buffer,
|};

type SymbolicLinkNode = {|
  ...NodeBase,
  type: 'symbolicLink',
  target: string,
|};

type EntityNode = DirectoryNode | FileNode | SymbolicLinkNode;

type NodeWatcher = {
  recursive: boolean,
  listener: (eventType: 'change' | 'rename', filePath: string) => void,
};

type Encoding =
  | 'ascii'
  | 'base64'
  | 'binary'
  | 'buffer'
  | 'hex'
  | 'latin1'
  | 'ucs2'
  | 'utf16le'
  | 'utf8';

type Resolution = {|
  +basename: string,
  +dirNode: DirectoryNode,
  +dirPath: Array<[string, EntityNode]>,
  +drive: string,
  +node: ?EntityNode,
  +realpath: string,
|};

type Descriptor = {|
  +nodePath: Array<[string, EntityNode]>,
  +node: FileNode,
  +readable: boolean,
  +writable: boolean,
  position: number,
|};

type FilePath = string | Buffer;

const FLAGS_SPECS: {
  [string]: {
    exclusive?: true,
    mustExist?: true,
    readable?: true,
    truncate?: true,
    writable?: true,
  },
} = {
  r: {mustExist: true, readable: true},
  'r+': {mustExist: true, readable: true, writable: true},
  'rs+': {mustExist: true, readable: true, writable: true},
  w: {truncate: true, writable: true},
  wx: {exclusive: true, truncate: true, writable: true},
  'w+': {readable: true, truncate: true, writable: true},
  'wx+': {exclusive: true, readable: true, truncate: true, writable: true},
};

const ASYNC_FUNC_NAMES = [
  'access',
  'close',
  'copyFile',
  'fstat',
  'fsync',
  'fdatasync',
  'lstat',
  'open',
  'read',
  'readdir',
  'readFile',
  'readlink',
  'realpath',
  'stat',
  'unlink',
  'write',
  'writeFile',
];

type Options = {
  /**
   * On a win32 FS, there will be drives at the root, like "C:\". On a Posix FS,
   * there is only one root "/".
   */
  platform?: 'win32' | 'posix',
  /**
   * To be able to use relative paths, this function must provide the current
   * working directory. A possible implementation is to forward `process.cwd`,
   * but one must ensure to create that directory in the memory FS (no
   * directory is ever created automatically).
   */
  cwd?: () => string,
};

/**
 * Simulates `fs` API in an isolated, memory-based filesystem. This is useful
 * for testing systems that rely on `fs` without affecting the real filesystem.
 * This is meant to be a drop-in replacement/mock for `fs`, so it mimics
 * closely the behavior of file path resolution and file accesses.
 */
class MemoryFs {
  _roots: Map<string, DirectoryNode>;
  _fds: Map<number, Descriptor>;
  _nextId: number;
  _platform: 'win32' | 'posix';
  _pathSep: string;
  _cwd: ?() => string;
  constants = constants;

  close: (fd: number, callback: (error: ?Error) => mixed) => void;
  copyFile: ((
    src: FilePath,
    dest: FilePath,
    callback: (error: Error) => mixed,
  ) => void) &
    ((
      src: FilePath,
      dest: FilePath,
      flags?: number,
      callback: (error: ?Error) => mixed,
    ) => void);
  open: (
    filePath: FilePath,
    flag: string | number,
    mode?: number,
    callback: (error: ?Error, fd: ?number) => mixed,
  ) => void;
  read: (
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: ?number,
    callback: (?Error, ?number) => mixed,
  ) => void;
  readFile: (
    filePath: FilePath,
    options?:
      | {
          encoding?: Encoding,
          flag?: string,
        }
      | Encoding
      | ((?Error, ?Buffer | string) => mixed),
    callback?: (?Error, ?Buffer | string) => mixed,
  ) => void;
  realpath: (filePath: FilePath, callback: (?Error, ?string) => mixed) => void;
  write: (
    fd: number,
    bufferOrString: Buffer | string,
    offsetOrPosition?: number | ((?Error, number) => mixed),
    lengthOrEncoding?: number | string | ((?Error, number) => mixed),
    position?: number | ((?Error, number) => mixed),
    callback?: (?Error, number) => mixed,
  ) => void;
  writeFile: (
    filePath: FilePath,
    data: Buffer | string,
    options?:
      | {
          encoding?: ?Encoding,
          mode?: ?number,
          flag?: ?string,
        }
      | Encoding
      | ((?Error) => mixed),
    callback?: (?Error) => mixed,
  ) => void;

  constructor(options?: ?Options) {
    this._platform = (options && options.platform) || 'posix';
    this._cwd = options && options.cwd;
    this._pathSep = this._platform === 'win32' ? '\\' : '/';
    this.reset();
    ASYNC_FUNC_NAMES.forEach(funcName => {
      const func = (this: $FlowFixMe)[`${funcName}Sync`];
      (this: $FlowFixMe)[funcName] = function(...args) {
        const callback = args.pop();
        process.nextTick(() => {
          let retval;
          try {
            retval = func.apply(null, args);
          } catch (error) {
            callback(error);
            return;
          }
          callback(null, retval);
        });
      };
    });
  }

  reset() {
    this._nextId = 1;
    this._roots = new Map();
    if (this._platform === 'posix') {
      this._roots.set('', this._makeDir(0o777));
    } else if (this._platform === 'win32') {
      this._roots.set('C:', this._makeDir(0o777));
    }
    this._fds = new Map();
  }

  accessSync = (filePath: FilePath, mode?: number): void => {
    if (mode == null) {
      mode = constants.F_OK;
    }
    const stats = this.statSync(filePath);
    if (mode == constants.F_OK) {
      return;
    }
    const filePathStr = pathStr(filePath);
    if ((mode & constants.R_OK) !== 0) {
      if (
        !(
          (stats.mode & constants.S_IROTH) !== 0 ||
          ((stats.mode & constants.S_IRGRP) !== 0 && stats.gid === getgid()) ||
          ((stats.mode & constants.S_IRUSR) !== 0 && stats.uid === getuid())
        )
      ) {
        throw makeError('EPERM', filePathStr, 'file cannot be read');
      }
    }
    if ((mode & constants.W_OK) !== 0) {
      if (
        !(
          (stats.mode & constants.S_IWOTH) !== 0 ||
          ((stats.mode & constants.S_IWGRP) !== 0 && stats.gid === getgid()) ||
          ((stats.mode & constants.S_IWUSR) !== 0 && stats.uid === getuid())
        )
      ) {
        throw makeError('EPERM', filePathStr, 'file cannot be written to');
      }
    }
    if ((mode & constants.X_OK) !== 0) {
      if (
        !(
          (stats.mode & constants.S_IXOTH) !== 0 ||
          ((stats.mode & constants.S_IXGRP) !== 0 && stats.gid === getgid()) ||
          ((stats.mode & constants.S_IXUSR) !== 0 && stats.uid === getuid())
        )
      ) {
        throw makeError('EPERM', filePathStr, 'file cannot be executed');
      }
    }
  };

  closeSync = (fd: number): void => {
    const desc = this._getDesc(fd);
    if (desc.writable) {
      this._emitFileChange(desc.nodePath.slice(), {eventType: 'change'});
    }
    this._fds.delete(fd);
  };

  copyFileSync = (src: FilePath, dest: FilePath, flags?: number = 0) => {
    const options = flags & constants.COPYFILE_EXCL ? {flag: 'wx'} : {};
    this.writeFileSync(dest, this.readFileSync(src), options);
  };

  fsyncSync = (fd: number): void => {
    this._getDesc(fd);
  };

  fdatasyncSync = (fd: number): void => {
    this._getDesc(fd);
  };

  openSync = (
    filePath: FilePath,
    flags: string | number,
    mode?: number,
  ): number => {
    if (typeof flags === 'number') {
      throw new Error(`numeric flags not supported: ${flags}`);
    }
    return this._open(pathStr(filePath), flags, mode);
  };

  readSync = (
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: ?number,
  ): number => {
    const desc = this._getDesc(fd);
    if (!desc.readable) {
      throw makeError('EBADF', null, 'file descriptor cannot be written to');
    }
    if (position != null) {
      desc.position = position;
    }
    const endPos = Math.min(desc.position + length, desc.node.content.length);
    desc.node.content.copy(buffer, offset, desc.position, endPos);
    const bytesRead = endPos - desc.position;
    desc.position = endPos;
    return bytesRead;
  };

  readdirSync = (
    filePath: FilePath,
    options?:
      | {
          encoding?: Encoding,
        }
      | Encoding,
  ): Array<string | Buffer> => {
    let encoding;
    if (typeof options === 'string') {
      encoding = options;
    } else if (options != null) {
      ({encoding} = options);
    }
    filePath = pathStr(filePath);
    const {node} = this._resolve(filePath);
    if (node == null) {
      throw makeError('ENOENT', filePath, 'no such file or directory');
    }
    if (node.type !== 'directory') {
      throw makeError('ENOTDIR', filePath, 'not a directory');
    }
    return Array.from(node.entries.keys()).map(str => {
      if (encoding === 'utf8') {
        return str;
      }
      const buffer = Buffer.from(str);
      if (encoding === 'buffer') {
        return buffer;
      }
      return buffer.toString(encoding);
    });
  };

  readFileSync = (
    filePath: FilePath,
    options?:
      | {
          encoding?: Encoding,
          flag?: string,
        }
      | Encoding,
  ): Buffer | string => {
    let encoding, flag;
    if (typeof options === 'string') {
      encoding = options;
    } else if (options != null) {
      ({encoding, flag} = options);
    }
    const fd = this._open(pathStr(filePath), flag || 'r');
    const chunks = [];
    try {
      const buffer = Buffer.alloc(1024);
      let bytesRead;
      do {
        bytesRead = this.readSync(fd, buffer, 0, buffer.length, null);
        if (bytesRead === 0) {
          continue;
        }
        const chunk = Buffer.alloc(bytesRead);
        buffer.copy(chunk, 0, 0, bytesRead);
        chunks.push(chunk);
      } while (bytesRead > 0);
    } finally {
      this.closeSync(fd);
    }
    const result = Buffer.concat(chunks);
    if (encoding == null) {
      return result;
    }
    return result.toString(encoding);
  };

  readlinkSync = (
    filePath: FilePath,
    options: ?Encoding | {encoding: ?Encoding},
  ): string | Buffer => {
    let encoding;
    if (typeof options === 'string') {
      encoding = options;
    } else if (options != null) {
      ({encoding} = options);
    }
    filePath = pathStr(filePath);
    const {node} = this._resolve(filePath, {keepFinalSymlink: true});
    if (node == null) {
      throw makeError('ENOENT', filePath, 'no such file or directory');
    }
    if (node.type !== 'symbolicLink') {
      throw makeError('EINVAL', filePath, 'entity is not a symlink');
    }
    if (encoding == null || encoding === 'utf8') {
      return node.target;
    }
    const buf = Buffer.from(node.target);
    if (encoding == 'buffer') {
      return buf;
    }
    return buf.toString(encoding);
  };

  realpathSync = (filePath: FilePath): string => {
    return this._resolve(pathStr(filePath)).realpath;
  };

  writeSync = (
    fd: number,
    bufferOrString: Buffer | string,
    offsetOrPosition?: number,
    lengthOrEncoding?: number | string,
    position?: number,
  ): number => {
    let encoding, offset, length, buffer;
    if (typeof bufferOrString === 'string') {
      position = offsetOrPosition;
      encoding = lengthOrEncoding;
      buffer = (Buffer: $FlowFixMe).from(
        bufferOrString,
        (encoding: $FlowFixMe) || 'utf8',
      );
    } else {
      offset = offsetOrPosition;
      if (lengthOrEncoding != null && typeof lengthOrEncoding !== 'number') {
        throw new Error('invalid length');
      }
      length = lengthOrEncoding;
      buffer = bufferOrString;
    }
    if (offset == null) {
      offset = 0;
    }
    if (length == null) {
      length = buffer.length;
    }
    return this._write(fd, buffer, offset, length, position);
  };

  writeFileSync = (
    filePathOrFd: FilePath | number,
    data: Buffer | string,
    options?:
      | {
          encoding?: ?Encoding,
          mode?: ?number,
          flag?: ?string,
        }
      | Encoding,
  ): void => {
    let encoding, mode, flag;
    if (typeof options === 'string') {
      encoding = options;
    } else if (options != null) {
      ({encoding, mode, flag} = options);
    }
    if (encoding == null) {
      encoding = 'utf8';
    }
    if (typeof data === 'string') {
      data = (Buffer: $FlowFixMe).from(data, encoding);
    }
    const fd: number =
      typeof filePathOrFd === 'number'
        ? filePathOrFd
        : this._open(pathStr(filePathOrFd), flag || 'w', mode);
    try {
      this._write(fd, data, 0, data.length);
    } finally {
      if (typeof filePathOrFd !== 'number') {
        this.closeSync(fd);
      }
    }
  };

  mkdirSync = (dirPath: string | Buffer, mode?: number): void => {
    if (mode == null) {
      mode = 0o777;
    }
    dirPath = pathStr(dirPath);
    const {dirNode, node, basename} = this._resolve(dirPath);
    if (node != null) {
      throw makeError('EEXIST', dirPath, 'directory or file already exists');
    }
    dirNode.entries.set(basename, this._makeDir(mode));
  };

  symlinkSync = (
    target: string | Buffer,
    filePath: FilePath,
    type?: string,
  ) => {
    if (type == null) {
      type = 'file';
    }
    if (type !== 'file') {
      throw new Error('symlink type not supported');
    }
    filePath = pathStr(filePath);
    const {dirNode, node, basename} = this._resolve(filePath);
    if (node != null) {
      throw makeError('EEXIST', filePath, 'directory or file already exists');
    }
    dirNode.entries.set(basename, {
      id: this._getId(),
      gid: getgid(),
      target: pathStr(target),
      mode: 0o666,
      uid: getuid(),
      type: 'symbolicLink',
      watchers: [],
    });
  };

  existsSync = (filePath: FilePath): boolean => {
    try {
      const {node} = this._resolve(pathStr(filePath));
      return node != null;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  };

  statSync = (filePath: FilePath) => {
    filePath = pathStr(filePath);
    const {node} = this._resolve(filePath);
    if (node == null) {
      throw makeError('ENOENT', filePath, 'no such file or directory');
    }
    return new Stats(node);
  };

  lstatSync = (filePath: FilePath) => {
    filePath = pathStr(filePath);
    const {node} = this._resolve(filePath, {
      keepFinalSymlink: true,
    });
    if (node == null) {
      throw makeError('ENOENT', filePath, 'no such file or directory');
    }
    return new Stats(node);
  };

  fstatSync = (fd: number) => {
    const desc = this._getDesc(fd);
    return new Stats(desc.node);
  };

  createReadStream = (
    filePath: FilePath,
    options?:
      | {
          autoClose?: ?boolean,
          encoding?: ?Encoding,
          end?: ?number,
          fd?: ?number,
          flags?: ?string,
          highWaterMark?: ?number,
          mode?: ?number,
          start?: ?number,
        }
      | Encoding,
  ) => {
    let autoClose, encoding, fd, flags, mode, start, end, highWaterMark;
    if (typeof options === 'string') {
      encoding = options;
    } else if (options != null) {
      ({autoClose, encoding, fd, flags, mode, start} = options);
      ({end, highWaterMark} = options);
    }
    let st = null;
    if (fd == null) {
      fd = this._open(pathStr(filePath), flags || 'r', mode);
      process.nextTick(() => (st: any).emit('open', fd));
    }
    const ffd = fd;
    const {readSync} = this;
    const ropt = {filePath, encoding, fd, highWaterMark, start, end, readSync};
    const rst = new ReadFileSteam(ropt);
    st = rst;
    if (autoClose !== false) {
      const doClose = () => {
        this.closeSync(ffd);
        rst.emit('close');
      };
      rst.on('end', doClose);
      rst.on('error', doClose);
    }
    return rst;
  };

  unlinkSync = (filePath: FilePath) => {
    filePath = pathStr(filePath);
    const {basename, dirNode, dirPath, node} = this._resolve(filePath, {
      keepFinalSymlink: true,
    });
    if (node == null) {
      throw makeError('ENOENT', filePath, 'no such file or directory');
    }
    if (node.type !== 'file' && node.type !== 'symbolicLink') {
      throw makeError('EISDIR', filePath, 'cannot unlink a directory');
    }
    dirNode.entries.delete(basename);
    this._emitFileChange(dirPath.concat([[basename, node]]), {
      eventType: 'rename',
    });
  };

  createWriteStream = (
    filePath: FilePath,
    options?:
      | {
          autoClose?: boolean,
          encoding?: Encoding,
          fd?: ?number,
          flags?: string,
          mode?: number,
          start?: number,
        }
      | Encoding,
  ) => {
    let autoClose, fd, flags, mode, start;
    if (typeof options !== 'string' && options != null) {
      ({autoClose, fd, flags, mode, start} = options);
    }
    let st = null;
    if (fd == null) {
      fd = this._open(pathStr(filePath), flags || 'w', mode);
      process.nextTick(() => (st: any).emit('open', fd));
    }
    const ffd = fd;
    const ropt = {fd, writeSync: this._write.bind(this), filePath, start};
    const rst = new WriteFileStream(ropt);
    st = rst;
    if (autoClose !== false) {
      const doClose = () => {
        this.closeSync(ffd);
        rst.emit('close');
      };
      rst.on('finish', doClose);
      rst.on('error', doClose);
    }
    return st;
  };

  watch = (
    filePath: FilePath,
    options?:
      | {
          encoding?: Encoding,
          recursive?: boolean,
          persistent?: boolean,
        }
      | Encoding,
    listener?: (
      eventType: 'rename' | 'change',
      filePath: ?string | Buffer,
    ) => mixed,
  ) => {
    filePath = pathStr(filePath);
    const {node} = this._resolve(filePath);
    if (node == null) {
      throw makeError('ENOENT', filePath, 'no such file or directory');
    }
    let encoding, recursive, persistent;
    if (typeof options === 'string') {
      encoding = options;
    } else if (options != null) {
      ({encoding, recursive, persistent} = options);
    }
    const watcher = new FSWatcher(node, {
      encoding: encoding != null ? encoding : 'utf8',
      recursive: recursive != null ? recursive : false,
      persistent: persistent != null ? persistent : false,
    });
    if (listener != null) {
      watcher.on('change', listener);
    }
    return watcher;
  };

  _makeDir(mode: number): DirectoryNode {
    return {
      entries: new Map(),
      gid: getgid(),
      id: this._getId(),
      mode,
      uid: getuid(),
      type: 'directory',
      watchers: [],
    };
  }

  _getId() {
    return ++this._nextId;
  }

  _open(filePath: string, flags: string, mode: ?number): number {
    if (mode == null) {
      mode = 0o666;
    }
    const spec = FLAGS_SPECS[flags];
    if (spec == null) {
      throw new Error(`flags not supported: \`${flags}\``);
    }
    const {writable = false, readable = false} = spec;
    const {exclusive, mustExist, truncate} = spec;
    let {dirNode, node, basename, dirPath} = this._resolve(filePath);
    let nodePath;
    if (node == null) {
      if (mustExist) {
        throw makeError('ENOENT', filePath, 'no such file or directory');
      }
      node = {
        content: Buffer.alloc(0),
        gid: getgid(),
        id: this._getId(),
        mode,
        uid: getuid(),
        type: 'file',
        watchers: [],
      };
      dirNode.entries.set(basename, node);
      nodePath = dirPath.concat([[basename, node]]);
      this._emitFileChange(nodePath.slice(), {eventType: 'rename'});
    } else {
      if (exclusive) {
        throw makeError('EEXIST', filePath, 'directory or file already exists');
      }
      if (node.type !== 'file') {
        throw makeError('EISDIR', filePath, 'cannot read/write to a directory');
      }
      if (truncate) {
        node.content = Buffer.alloc(0);
      }
      nodePath = dirPath.concat([[basename, node]]);
    }
    return this._getFd(filePath, {
      nodePath,
      node,
      position: 0,
      readable,
      writable,
    });
  }

  _parsePath(
    filePath: string,
  ): {|
    +drive: ?string,
    +entNames: Array<string>,
  |} {
    let drive;
    const sep = this._platform === 'win32' ? /[\\/]/ : /\//;
    if (this._platform === 'win32' && filePath.match(/^[a-zA-Z]:[\\/]/)) {
      drive = filePath.substring(0, 2);
      filePath = filePath.substring(3);
    }
    if (sep.test(filePath[0])) {
      if (this._platform === 'posix') {
        drive = '';
        filePath = filePath.substring(1);
      } else {
        throw makeError(
          'EINVAL',
          filePath,
          'path is invalid because it cannot start with a separator',
        );
      }
    }
    return {entNames: filePath.split(sep), drive};
  }

  /**
   * Implemented according with
   * http://man7.org/linux/man-pages/man7/path_resolution.7.html
   */
  _resolve(
    filePath: string,
    options?: {keepFinalSymlink: boolean},
  ): Resolution {
    let keepFinalSymlink = false;
    if (options != null) {
      ({keepFinalSymlink} = options);
    }
    if (filePath === '') {
      throw makeError('ENOENT', filePath, 'no such file or directory');
    }
    let {drive, entNames} = this._parsePath(filePath);
    if (drive == null) {
      const {_cwd} = this;
      if (_cwd == null) {
        throw new Error(
          `The path \`${filePath}\` cannot be resolved because no ` +
            'current working directory function has been specified. Set the ' +
            '`cwd` option field to specify a current working directory.',
        );
      }
      const cwPath = this._parsePath(_cwd());
      drive = cwPath.drive;
      if (drive == null) {
        throw new Error(
          "On a win32 FS, the options' `cwd()` must return a valid win32 " +
            'absolute path. This happened while trying to ' +
            `resolve: \`${filePath}\``,
        );
      }
      entNames = cwPath.entNames.concat(entNames);
    }
    checkPathLength(entNames, filePath);
    const root = this._getRoot(drive, filePath);
    const context = {
      drive,
      node: root,
      nodePath: [['', root]],
      entNames,
      symlinkCount: 0,
      keepFinalSymlink,
    };
    while (context.entNames.length > 0) {
      const entName = context.entNames.shift();
      this._resolveEnt(context, filePath, entName);
    }
    const {nodePath} = context;
    return {
      drive: context.drive,
      realpath: context.drive + nodePath.map(x => x[0]).join(this._pathSep),
      dirNode: (() => {
        const dirNode =
          nodePath.length >= 2
            ? nodePath[nodePath.length - 2][1]
            : context.node;
        if (dirNode == null || dirNode.type !== 'directory') {
          throw new Error('failed to resolve');
        }
        return dirNode;
      })(),
      node: context.node,
      basename: nullthrows(nodePath[nodePath.length - 1][0]),
      dirPath: nodePath
        .slice(0, -1)
        .map(nodePair => [nodePair[0], nullthrows(nodePair[1])]),
    };
  }

  _resolveEnt(context, filePath, entName) {
    const {node} = context;
    if (node == null) {
      throw makeError('ENOENT', filePath, 'no such file or directory');
    }
    if (node.type !== 'directory') {
      throw makeError('ENOTDIR', filePath, 'not a directory');
    }
    const {entries} = node;
    if (entName === '' || entName === '.') {
      return;
    }
    if (entName === '..') {
      const {nodePath} = context;
      if (nodePath.length > 1) {
        nodePath.pop();
        context.node = nodePath[nodePath.length - 1][1];
      }
      return;
    }
    const childNode = entries.get(entName);
    if (
      childNode == null ||
      childNode.type !== 'symbolicLink' ||
      (context.keepFinalSymlink && context.entNames.length === 0)
    ) {
      context.node = childNode;
      context.nodePath.push([entName, childNode]);
      return;
    }
    if (context.symlinkCount >= 10) {
      throw makeError('ELOOP', filePath, 'too many levels of symbolic links');
    }
    const {entNames, drive} = this._parsePath(childNode.target);
    if (drive != null) {
      context.drive = drive;
      context.node = this._getRoot(drive, filePath);
      context.nodePath = [['', context.node]];
    }
    context.entNames = entNames.concat(context.entNames);
    checkPathLength(context.entNames, filePath);
    ++context.symlinkCount;
  }

  _getRoot(drive: string, filePath: string): DirectoryNode {
    const root = this._roots.get(drive.toUpperCase());
    if (root == null) {
      throw makeError('ENOENT', filePath, `no such drive: \`${drive}\``);
    }
    return root;
  }

  _write(
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: ?number,
  ): number {
    const desc = this._getDesc(fd);
    if (!desc.writable) {
      throw makeError('EBADF', null, 'file descriptor cannot be written to');
    }
    if (position == null) {
      position = desc.position;
    }
    const {node} = desc;
    if (node.content.length < position + length) {
      const newBuffer = Buffer.alloc(position + length);
      node.content.copy(newBuffer, 0, 0, node.content.length);
      node.content = newBuffer;
    }
    buffer.copy(node.content, position, offset, offset + length);
    desc.position = position + length;
    return buffer.length;
  }

  _getFd(filePath: string, desc: Descriptor): number {
    let fd = 3;
    while (this._fds.has(fd)) {
      ++fd;
    }
    if (fd >= 256) {
      throw makeError('EMFILE', filePath, 'too many open files');
    }
    this._fds.set(fd, desc);
    return fd;
  }

  _getDesc(fd: number): Descriptor {
    const desc = this._fds.get(fd);
    if (desc == null) {
      throw makeError('EBADF', null, 'file descriptor is not open');
    }
    return desc;
  }

  _emitFileChange(
    nodePath: Array<[string, EntityNode]>,
    options: {eventType: 'rename' | 'change'},
  ): void {
    const fileNode = nodePath.pop();
    let filePath = fileNode[0];
    let recursive = false;

    for (const watcher of fileNode[1].watchers) {
      watcher.listener(options.eventType, filePath);
    }

    while (nodePath.length > 0) {
      const dirNode = nodePath.pop();
      for (const watcher of dirNode[1].watchers) {
        if (recursive && !watcher.recursive) {
          continue;
        }
        watcher.listener(options.eventType, filePath);
      }
      filePath = dirNode[0] + this._pathSep + filePath;
      recursive = true;
    }
  }
}

class Stats {
  _type: string;
  dev: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  blksize: number;
  ino: number;
  size: number;
  blocks: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;

  /**
   * Don't keep a reference to the node as it may get mutated over time.
   */
  constructor(node: EntityNode) {
    this._type = node.type;
    this.dev = 1;
    this.mode = node.mode;
    this.nlink = 1;
    this.uid = node.uid;
    this.gid = node.gid;
    this.rdev = 0;
    this.blksize = 1024;
    this.ino = node.id;
    this.size =
      node.type === 'file'
        ? node.content.length
        : node.type === 'symbolicLink'
          ? node.target.length
          : 0;
    this.blocks = Math.ceil(this.size / 512);
    this.atimeMs = 1;
    this.mtimeMs = 1;
    this.ctimeMs = 1;
    this.birthtimeMs = 1;
    this.atime = new Date(this.atimeMs);
    this.mtime = new Date(this.mtimeMs);
    this.ctime = new Date(this.ctimeMs);
    this.birthtime = new Date(this.birthtimeMs);
  }

  isFile(): boolean {
    return this._type === 'file';
  }
  isDirectory(): boolean {
    return this._type === 'directory';
  }
  isBlockDevice(): boolean {
    return false;
  }
  isCharacterDevice(): boolean {
    return false;
  }
  isSymbolicLink(): boolean {
    return this._type === 'symbolicLink';
  }
  isFIFO(): boolean {
    return false;
  }
  isSocket(): boolean {
    return false;
  }
}

type ReadSync = (
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
  position: ?number,
) => number;

class ReadFileSteam extends stream.Readable {
  _buffer: Buffer;
  _fd: number;
  _positions: ?{current: number, last: number};
  _readSync: ReadSync;
  bytesRead: number;
  path: string | Buffer;

  constructor(options: {
    filePath: FilePath,
    encoding: ?Encoding,
    end: ?number,
    fd: number,
    highWaterMark: ?number,
    readSync: ReadSync,
    start: ?number,
  }) {
    const {highWaterMark, fd} = options;
    // eslint-disable-next-line lint/flow-no-fixme
    // $FlowFixMe: Readable does accept null of undefined for that value.
    super({highWaterMark});
    this.bytesRead = 0;
    this.path = options.filePath;
    this._readSync = options.readSync;
    this._fd = fd;
    this._buffer = Buffer.alloc(1024);
    const {start, end} = options;
    if (start != null) {
      this._readSync(fd, Buffer.alloc(0), 0, 0, start);
    }
    if (end != null) {
      this._positions = {current: start || 0, last: end + 1};
    }
  }

  _read(size) {
    let bytesRead;
    const {_buffer} = this;
    do {
      const length = this._getLengthToRead();
      const position = this._positions && this._positions.current;
      bytesRead = this._readSync(this._fd, _buffer, 0, length, position);
      if (this._positions != null) {
        this._positions.current += bytesRead;
      }
      this.bytesRead += bytesRead;
    } while (this.push(bytesRead > 0 ? _buffer.slice(0, bytesRead) : null));
  }

  _getLengthToRead() {
    const {_positions, _buffer} = this;
    if (_positions == null) {
      return _buffer.length;
    }
    const leftToRead = Math.max(0, _positions.last - _positions.current);
    return Math.min(_buffer.length, leftToRead);
  }
}

type WriteSync = (
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
  position?: number,
) => number;

class WriteFileStream extends stream.Writable {
  bytesWritten: number;
  path: string | Buffer;
  _fd: number;
  _writeSync: WriteSync;

  constructor(opts: {
    fd: number,
    filePath: FilePath,
    writeSync: WriteSync,
    start?: number,
  }) {
    super();
    this.path = opts.filePath;
    this.bytesWritten = 0;
    this._fd = opts.fd;
    this._writeSync = opts.writeSync;
    if (opts.start != null) {
      this._writeSync(opts.fd, Buffer.alloc(0), 0, 0, opts.start);
    }
  }

  _write(buffer, encoding, callback) {
    try {
      const bytesWritten = this._writeSync(this._fd, buffer, 0, buffer.length);
      this.bytesWritten += bytesWritten;
    } catch (error) {
      callback(error);
      return;
    }
    callback();
  }
}

class FSWatcher extends EventEmitter {
  _encoding: Encoding;
  _node: EntityNode;
  _nodeWatcher: NodeWatcher;
  _persistIntervalId: IntervalID;

  constructor(
    node: EntityNode,
    options: {encoding: Encoding, recursive: boolean, persistent: boolean},
  ) {
    super();
    this._encoding = options.encoding;
    this._nodeWatcher = {
      recursive: options.recursive,
      listener: this._listener,
    };
    node.watchers.push(this._nodeWatcher);
    this._node = node;
    if (options.persistent) {
      this._persistIntervalId = setInterval(() => {}, 60000);
    }
  }

  close() {
    this._node.watchers.splice(this._node.watchers.indexOf(this._nodeWatcher));
    clearInterval(this._persistIntervalId);
  }

  _listener = (eventType, filePath: string) => {
    const encFilePath =
      this._encoding === 'buffer' ? Buffer.from(filePath, 'utf8') : filePath;
    try {
      this.emit('change', eventType, encFilePath);
    } catch (error) {
      this.close();
      this.emit('error', error);
    }
  };
}

function checkPathLength(entNames, filePath) {
  if (entNames.length > 32) {
    throw makeError(
      'ENAMETOOLONG',
      filePath,
      'file path too long (or one of the intermediate ' +
        'symbolic link resolutions)',
    );
  }
}

function pathStr(filePath: FilePath): string {
  if (typeof filePath === 'string') {
    return filePath;
  }
  return filePath.toString('utf8');
}

function makeError(code: string, filePath: ?string, message: string) {
  const err: $FlowFixMe = new Error(
    filePath != null
      ? `${code}: \`${filePath}\`: ${message}`
      : `${code}: ${message}`,
  );
  err.code = code;
  err.errno = constants[code];
  err.path = filePath;
  return err;
}

function nullthrows<T>(x: ?T): T {
  if (x == null) {
    throw new Error('item was null or undefined');
  }
  return x;
}

function getgid(): number {
  return process.getgid != null ? process.getgid() : -1;
}

function getuid(): number {
  return process.getuid != null ? process.getuid() : -1;
}

module.exports = MemoryFs;
