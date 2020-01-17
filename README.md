# nipo

Simple and opinionated Pino-based logger plugin for Hapi.js.

[![Build Status](https://secure.travis-ci.org/kanongil/nipo.svg?branch=master)](http://travis-ci.org/kanongil/nipo)

Lead Maintainer: [Gil Pedersen](https://github.com/kanongil)

## Setup and configuration

```js
await server.register({
    plugin: require('Nipo'),
    options: {
        pino: { … }
    }
});
```

This will log JSON'ified response entries to `stdout`, and server and request events to `stderr`.
To make the logs prettier while developing, install the `pino-pretty` module, and enable it using the `prettyPrint` pino option.
