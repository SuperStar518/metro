# Metro Bundler

[![CircleCI Build Status](https://circleci.com/gh/facebook/metro-bundler.svg?style=shield)](https://circleci.com/gh/facebook/metro-bundler)
[![npm version](https://badge.fury.io/js/metro-bundler.svg)](http://badge.fury.io/js/metro-bundler)

🚇 The JavaScript bundler for React Native.

- **🚅 Fast**: We aim for sub-second reload cycles, fast startup and quick bundling speeds.
- **⚖️ Scalable**: Works with thousands of modules in a single application.
- **⚛️ Integrated**: Supports every React Native project out of the box.

This project was previously part of the [react-native](https://github.com/facebook/react-native) repository. In this smaller repository it is easier for the team working on Metro Bundler to respond to both issues and pull requests. See [react-native#13976](https://github.com/facebook/react-native/issues/13976) for the initial announcement.

# Running `metro-bundler`

Right now, Metro Bundler cannot run by itself. Instead, some functions are exposed so that the configuration can be passed into it. First, require the module by doing:

```js
const metroBundler = require('metro-bundler');
```

Within the object returned, two main methods are given:

## Method `createServer(serverOptions)`

Given a set of options (same ones as the `build` method), a `metro-server` will be returned. You can then hook this into a proper HTTP(S) server by using its `processRequest` method:


```js
'use strict';

const http = require('http');
const metroBundler = require('metro-bundler');
const TerminalReporter = require('metro-bundler/src/lib/TerminalReporter');
const Terminal = require('metro-bundler/src/lib/Terminal');

const metroBundlerServer = metroBundler.createServer({
  assetRegistryPath: __dirname,
  projectRoots: [__dirname],
  reporter: new TerminalReporter(new Terminal(process.stdout)),
});

const httpServer = http.createServer(
  metroBundlerServer.processRequest.bind(metroBundlerServer),
);

httpServer.listen(8081);
```

In order to be also compatible with express apps, processRequest will also call its third parameter when the request could not be handled by Metro bundler. This will allow you integrating the server in your existing server, or extend a new one:

```js
const httpServer = http.createServer((req, res) => {
  metroBundlerServer.processRequest(req, res, () => {
    // Metro does not know how to handle the request.
  });
});
```

If you are using [Express](http://expressjs.com/), you can just pass `processRequest` as a middleware:

```js
const express = require('express');
const app = express();

app.use(
  metroBundlerServer.processRequest.bind(metroBundlerServer),
);

app.listen(8081);
```

## Method `build(serverOptions, bundleOptions)`

Given a set of options that you would typically pass to a server, plus a set of options specific to the bundle itself, a bundle will be built. The return value is a Promise that resolves to an object with two properties, `code` and `map`. This is useful at build time.

# Available options

## Possible server options

* `assetExts (Array<string>)`: List of extensions that should be considered as assets. Assets are non-JavaScript files that can be required with a `require` call, and that the server can return back. Defaults to a sane, comprehensive list of image, video, audio, document and font formats.
* `assetRegistryPath (string)`: Root where to look for the assets. See `assetExts` for more information.
* `blacklistRE (RegExp)`: Regular expression matching files that do not have to be processed when recursively crawling the tree of dependencies from the root. Defaults to a non-matching regular expression (meaning all modules are processed).
* `cacheVersion (string)`: Used to invalidate caches when changes happen on the transform pipeline. By default, transformed files are cached for speed.
* `enableBabelRCLookup (boolean)`: True if `.babelrc` files coming from other Node modules have to be looked up or not (i.e. if their transforms have to be applied to the files contained within the module).
* `getPolyfills ((platform) => Array<string>)`: Method that returns a list of paths to polyfills to be added to the bundle. The platform (if provided) will be passed as the only argument of the method. Polyfills are guaranteed to be loaded before any code, and in the provided order in the array.
* `getTransformOptions ((mainModuleName, options, getDependenciesOf) => Promise<Array<string>>)`:
* `getUseGlobalHotkey (() => boolean)`: Method that returns whether the global hotkey should be used or not. Useful especially on Linux servers.
* `maxWorkers (number)`: Maximum amount of workers to use when transforming and bundling. By default it uses an amount computed using the available cores of the processor (approximately 50% of them).
* `platforms (Array<string>)`: Array of platforms supported. Currently you can pass `'ios'` and `'android'` there. This information will be used for bundle generation (both the code included and the format to be served).
* `postProcessModules ((modules, entryPoints) => Array<Module>)`: Allows to post process the list of modules, either by adding, removing or modifying the existing ones.
* `projectRoots (Array<string>)`: List of all directories to look for source files. When asking for a particular bundle, each of the roots will be examined to see if the requested file exists in one of these.
* `reporter (Reporter)`: a reporter instance that will be used to report progress. Various reporters are provided with Metro Bundler,
* `resetCache (boolean)`: Metro bundler holds an internal, persisted cache where all the transformed modules (using the provided transformer in `transformModulePath`) is stored. If the file does not change, the transformed file will be served. When passing `true` to `resetCache`, all of the cache will be thrown away.
* `silent (boolean)`: Whether bundling progress should be reported to the reporter given in the `reporter` option. Defaults to `false`.
* `sourceExts`: List of extensions that should be considered as source code. Source code files are files that will be transformed and bundled all at once. Defaults to JS and JSON extensions.
* `transformModulePath (string)`: Full path of the JS file that contains the transformer. Read further on the transformer section for more information. The default transformer is a no-op one: it just outputs the code as it gets input.

## Possible bundle options:

* `dev (boolean)`: optional boolean indicating if the bundle has to be built in development mode. Implies things like setting `__DEV__` to `true`. Defaults to `false`.
* `entryFile (string)`: entry point for bundling the file.
* `generateSourceMaps (boolean)`: whether source Maps should be generated or not. Defaults to `false`.
* `inlineSourceMap (boolean)`: indicates whether the source map is provided inlined with the bundle (as a bas64 encoded URL), or in a separate file. When provided as a separate file, the URL where it will be found can be customized with `sourceMapUrl`. Defaults to `false`.
* `minify (boolean)`: whether code should be minified. Defaults to `false`.
* `platform (string)`: if a list of platforms is provided, a particular platform can be passed.
* `sourceMapUrl (string)`: URL where the source map can be found. It defaults to the same same URL as the bundle, but changing the extension from `.bundle` to `.map`. When `inlineSourceMap` is `true`, this property has no effect.

# URL and bundle request

The server has the ability to serve assets, bundles and source maps for those bundles.

## Assets

In order to request an asset, you can freely use the `require` method as if it was another JS file. The server will treat this specific `require` calls  and make them return the path to that file. When an asset is requested (an asset is recognized by its extension, which has to be on the `assetExts` array) it is generally served as-is.

However, the server is also able to serve specific assets depending on the platform and on the requested size (in the case of images). The way you specify the platform is via the dotted suffix (e.g. `.ios`) and the resolution via the at suffix (e.g. `@2x`). This is transparently handled for you when using `require`.

## Bundle

Any JS file can be used as the root for a bundle request. The file will be looked into each of the project roots provided (via the `projectRoots` property of the server). All files that are required by the root will be recursively included. In order to request a bundle, just change the extension from `.js` to `.bundle`. Options for building the bundle are passed as query parameters (all optional).

* `dev`: build the bundle in development mode or not. Maps 1:1 to the `dev` setting of the bundles. Pass `true` or `false` as strings into the URL.
* `platform`: platform requesting the bundle. Can be `ios` or `android`. Maps 1:1 to the `platform` setting of the bundles.
* `minify`: whether code should be minified or not. Maps 1:1 to the `minify` setting of the bundles. Pass `true` or `false` as strings into the URL.
* `excludeSource`: whether sources should be included in the source map or not. Pass `true` or `false` as strings into the URL.

For instance, requesting `http://localhost:8081/foo/bar/baz.bundle?dev=true&platform=ios` will create a bundle out of `foo/bar/baz.js` for iOS in development mode.

## Source maps

Source maps are built for each bundle by using the same URL as the bundle (thus, the same as the JS file acting as a root). This will only work when `inlineSourceMap` is set to `false`. All options you passed to the bundle will be added to the source map URL; otherwise, they wouldn't match.

# JavaScript transformer

The JavaScript transformer (`transformModulePath`) is the place where JS code will be manipulated; useful for calling Babel. The transformer can export two methods:

## Method `transform(module)`

Mandatory method that will transform code. The object received has information about the module being transformed (e.g its path, code...) and the returned object has to contain a `code` key that is the result of the transform. The default transformer shipped is a pretty good place to start:

```js
module.exports.transform = file => {
  return {
    code: file.src,
  };
});
```

If you would like to plug-in babel, you can simply do that by passing the code to it:

```js
const {transform} = require('babel-core');

module.exports.transform = file => {
  return transform(file.src, {
    // Babel options...
  });
});
```

## Method `getCacheKey()`

Optional method that returns the cache key of the transformer. When using different transformers, this allows to correctly tie a transformed file to the transformer that converted it. The result of the method has to be a `string`.

# Bundling

When bundling, each of the modules gets assigned a numeric id, meaning no dynamic requires are supported. Requires are changed by its numeric version, and modules are stored in different possible formats. Three different formats of bundling are supported:

## Plain bundle

This is the standard bundling format. In this format, all files are wrapped with a function call, then added to the global file. This is useful for environments that expect a JS only bundle (e.g. a browser). Just requiring the entry point with the `.bundle` extension should trigger a build of it.

## Indexed RAM bundle

This format composes the bundle as a binary file, which format has the following parts (all numbers are expressed in Little Endian):

* A magic number: a `uint32` must be located at the beginning of the file, with the value '0xFB0BD1E5'. This is used to verify the file.
* An offset table: the table is a sequence of `uint32` pairs, with a header
    * For the header, two `uint32`s can be found: the length of the table, and the length of the startup code.
    * For the pairs, they represent the offset in the file and the length of code module, in bytes.
* Each of the modules, finished by a null byte (`\0`).

```
` 0                   1                   2                   3                   4                   5                   6
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                          Magic number                         |                          Header size                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Startup code size                       |                        Module 0 offset                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Module 0 length                        |                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+                                                               +
|                                                                                                                               |
+                                                              ...                                                              +
|                                                                                                                               |
+                                                               +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |                        Module n offset                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Module n length                        | Module 0 code | Module 0 code |      ...      |       \0      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Module 1 code | Module 1 code |      ...      |       \0      |                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+                                                               +
|                                                                                                                               |
+                                                              ...                                                              +
|                                                                                                                               |
+                                                               +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               | Module n code | Module n code |      ...      |       \0      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+`
```

This structure is optimal for an environment that is able to load all code in memory at once:

* By using the offset table, one can load any module in constant time, where the code for module `x` is located at `file[(x + 3) * sizeof(uint32)]`. Since there is a null character (`\0`) separating all modules, usually length does not even need to be used, and the module can be loaded directly as an ASCIIZ string.
* Startup code is always found at `file[sizeof(uint32)]`.

This bundling is usually used by iOS.

## File RAM bundle

Each module is stored as a file, with the name `js-modules/${id}.js`, plus an extra file called `UNBUNDLE` is created, which its only content is the magic number, `0xFB0BD1E5`. Note that the `UNBUNDLE` file is created at the root.
This bundling is usually used by Android, since package contents are zipped, and access to a zipped file is much faster. If the indexed format was used instead, all the bundled should be unzipped at once to get the code for the corresponding module.
