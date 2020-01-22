'use strict';

const Hoek = require('@hapi/hoek');
const Joi = require('@hapi/joi');
const Pino = require('pino');

const Utils = require('./utils');


const internals = {
    hasPretty: (() => {

        try {
            return !!require.resolve('pino-pretty');
        }
        catch (err) {}
    })()
};


internals.logResponseError = function (logger, response, id) {

    const { _error: error } = response;

    if (error && response.statusCode !== 500 && logger.isLevelEnabled('trace')) {
        logger.trace({
            request: id,
            tags: ['request', 'response', 'error'],
            err: error
        }, 'request-internal');
    }
};


internals.applyUserProps = function (request, obj, map) {

    if (map) {
        for (const [prop, path] of map) {
            const value = Hoek.reach(request, path);
            if (value !== undefined && value !== null) {
                obj[prop] = Utils.safeJsonObject(value);
            }
        }
    }
};


internals.onResponseHandler = function (logResponse, request) {

    const nipo = request.server.plugins.nipo;
    const { response, info } = request;
    let logLevel;

    if (response && logResponse) {
        const result = logResponse(request);
        if (!result) {
            // No response logging, but still check for event logging

            return internals.logResponseError(nipo.eventLogger, response, info.id);
        }

        if (typeof result === 'string') {
            logLevel = result;
        }
    }

    const req = {
        id: info.id,
        method: request.method,
        path: request.url.pathname + request.url.search,
        clientIp: info.remoteAddress,
        auth: request.auth.mode !== null ? {
            valid: request.auth.isAuthenticated,
            access: request.auth.isAuthenticated ? request.auth.isAuthorized : undefined,
            credentials: Utils.safeJsonObject(request.auth.credentials || undefined),
            strategy: request.auth.strategy || undefined
        } : undefined
    };

    const routeSettings = request.route.settings.plugins.nipo || {};

    internals.applyUserProps(request, req, routeSettings.req);

    const route = (request.params !== null) ? {
        id: request.route.settings.id,
        vhost: request.route.vhost,
        path: request.route.path,
        realm: request.route.realm.plugin
    } : {};

    if (response) {
        const responded = info.responded || info.completed || Date.now();
        const res = {
            statusCode: response.statusCode,
            //payload: ?bytes?,
            delay: responded - info.received
        };

        const { _error: error } = response;
        if (error) {
            res.reason = `${error.constructor.name}: ${error.message}`;
            if (error.data) {
                res.data = Utils.safeJsonObject(error.data);
            }

            internals.logResponseError(nipo.eventLogger, response, info.id);
        }

        internals.applyUserProps(request, res, routeSettings.res);

        if (!logLevel) {
            logLevel = response.statusCode >= 400 ? (response.statusCode >= 500 ? 'error' : 'warn') : 'info';
        }

        nipo.responseLogger[logLevel]({ req, route, res }, 'request-response');
    }
    else {
        nipo.responseLogger.debug({ req, route }, 'request-aborted');
    }
};


internals.onRequestErrorHandler = function (request, event, { implementation }) {

    const level = implementation ? 'fatal' : 'error';

    this[level]({
        request: event.request,
        tags: event.tags,
        err: event.error
    }, 'request-error');
};


internals.onRequestInternalHandler = function (request, event) {

    this.debug({
        request: event.request,
        tags: event.tags,
        data: Utils.safeJsonObject(event.data),
        err: event.error
    }, 'request-internal');
};


internals.onRequestAppHandler = function (request, event) {

    const nipo = request.server.plugins.nipo;
    const method = internals.lookupLevel(event.tags, 'info', nipo.tagLevels);

    this[method]({
        request: event.request,
        tags: event.tags,
        data: Utils.safeJsonObject(event.data),
        err: event.error
    }, 'request-app');
};


internals.onLogInternalHandler = function (server, event) {

    this.debug({
        server,
        tags: event.tags,
        data: Utils.safeJsonObject(event.data),
        err: event.error
    }, 'log-internal');
};


internals.onLogAppHandler = function (server, tagLevels, event) {

    const method = internals.lookupLevel(event.tags, 'info', tagLevels);

    this[method]({
        server,
        tags: event.tags,
        data: Utils.safeJsonObject(event.data),
        err: event.error
    }, 'log-app');
};


internals.onServerState = function (server, state) {

    this.info(server.info, `server-${state}`);
};


internals.errSerializer = function (error) {

    if (!(error instanceof Error)) {
        return error;
    }

    const { message, code, stack, data } = error;

    return {
        type: error.constructor.name,
        message: `${message}`,
        code: Utils.safeJsonObject(code),
        data: Utils.safeJsonObject(data),
        stack
    };
};


internals.pinoLevels = Pino().levels;


internals.optionsSchema = Joi.object({
    logResponse: Joi.func(),
    tagLevels: Joi.object().pattern(
        Joi.string(),
        Joi.string().equal(...Object.keys(internals.pinoLevels.values))
    ),
    stream: Joi.object({
        writable: Joi.boolean().equal(true)
    }).unknown(),
    pino: Joi.object({
        name: Joi.string(),
        level: Joi.alternatives().try(
            Joi.number().integer().min(0).allow(Infinity),
            Joi.string().equal(...Object.keys(internals.pinoLevels.values), 'silent')
        ),
        redact: Joi.alternatives().try(
            Joi.array().items(Joi.string()).single(),
            Joi.object({
                paths: Joi.array().items(Joi.string()).single(),
                censor: Joi.alternatives().try(Joi.string(), Joi.func()),
                remove: Joi.boolean()
            })
        ),
        enabled: Joi.boolean().default(true),
        crlf: Joi.boolean(),
        timestamp: Joi.alternatives().try(Joi.boolean(), Joi.func()).default(true),
        messageKey: Joi.string(),
        //$lab:coverage:off$
        prettyPrint: internals.hasPretty ? Joi.boolean() : Joi.boolean().equal(false),
        //$lab:coverage:on$
        useLevelLabels: Joi.boolean(),
        changeLevelName: Joi.string()
    }).default({})
}).strict();


internals.mapSchema = Joi.object().pattern(Joi.string(), Joi.alternatives(
    Joi.array().items(Joi.string(), Joi.symbol()),
    Joi.string().custom((value) => value.split('.'))
)).cast('map');


internals.configSchema = Joi.object({
    req: internals.mapSchema,
    res: internals.mapSchema
}).strict();


internals.onLevelChange = function (server, lvl, val, prevLvl, prevVal) {

    const levelChanged = (ref) => {

        const refVal = this.levels.values[ref];
        const isActive = refVal >= val;
        const isPrevActive = prevVal !== undefined && refVal >= prevVal;

        return isActive === isPrevActive ? undefined : isActive;
    };

    const update = (ref, handlers) => {

        const active = levelChanged(ref);
        if (active !== undefined) {
            const method = active ? 'on' : 'removeListener';
            for (const [event, handler] of handlers) {
                server.events[method](active ? event : event.name, handler);
            }
        }
    };

    update('debug', [
        [{ name: 'request', channels: 'internal' }, internals.handlers.requestInternal],
        [{ name: 'log', channels: 'internal' }, internals.handlers.logInternal]
    ]);

    update('info', [
        [{ name: 'request', channels: 'app' }, internals.handlers.requestApp],
        [{ name: 'log', channels: 'app' }, internals.handlers.logApp]
    ]);
};


internals.prepareLevelMap = function (tagLevels) {

    const map = new Map(Object.entries(internals.pinoLevels.values));
    for (const key in tagLevels) {
        map.set(key, internals.pinoLevels.values[tagLevels[key]]);
    }

    return map;
};

internals.lookupLevel = function (tags, defaultLevel, map) {

    let level = -1;

    for (const tag of tags) {
        const tagLevel = map.get(tag);
        if (tagLevel > level) {
            level = tagLevel;
        }
    }

    return level === -1 ? defaultLevel : internals.pinoLevels.labels[level];
};


internals.register = function (server, options) {

    options = Joi.attempt(options, internals.optionsSchema);

    const fixedLogger = function (pinoOptions, destination) {

        const logger = Pino({
            base: options.name ? {} : null,
            serializers: {
                err: internals.errSerializer
            },
            ...pinoOptions
        }, destination);

        // Hack to not log version - will be standard once v6 releases: https://github.com/pinojs/pino/pull/623

        logger[Pino.symbols.endSym] = `}${pinoOptions.crlf ? '\r\n' : '\n'}`;

        return logger;
    };

    const fast = function (stream) {

        // Use fast variant if write method has _not_ been modified

        return stream.hasOwnProperty('write') ? stream : Pino.destination(stream.fd);
    };

    const responseLogger = fixedLogger(options.pino, options.stream || fast(process.stdout));
    const eventLogger = fixedLogger(options.pino, options.stream || fast(process.stderr));

    const nipo = {};
    Object.defineProperty(nipo, 'responseLogger', { value: responseLogger });
    Object.defineProperty(nipo, 'eventLogger', { value: eventLogger });
    Object.defineProperty(nipo, 'tagLevels', { value: internals.prepareLevelMap(options.tagLevels) });
    Object.defineProperty(server.plugins, 'nipo', { value: nipo });

    // This guards callbacks against thrown errors

    const safeHandler = function (handler, ...boundArgs) {

        const boundFn = internals[handler].bind(eventLogger, ...boundArgs);

        return function (...args) {

            try {
                return boundFn(...args);
            }
            catch (err) {
                // eslint-disable-next-line no-ex-assign
                err = err || new Error(`Unknown throw during: ${handler}`);
                eventLogger.fatal({
                    server: server.info.id,
                    type: err.constructor.name,
                    message: err.message,
                    stack: err.stack
                }, 'nipo-error');
            }
        };
    };

    server.events.on('response', safeHandler('onResponseHandler', options.logResponse));
    server.events.on({ name: 'request', channels: 'error' }, safeHandler('onRequestErrorHandler'));

    internals.handlers = {
        requestInternal: safeHandler('onRequestInternalHandler'),
        logInternal: safeHandler('onLogInternalHandler', server.info.id),
        requestApp: safeHandler('onRequestAppHandler'),
        logApp: safeHandler('onLogAppHandler', server.info.id, nipo.tagLevels)
    };

    eventLogger.on('level-change', internals.onLevelChange.bind(eventLogger, server));
    internals.onLevelChange.call(eventLogger, server, eventLogger.level, eventLogger.levelVal);

    server.events.on('start', safeHandler('onServerState', server, 'started'));
    server.events.on('stop', safeHandler('onServerState', server, 'stopped'));

    server.ext('onPreStart', () => {

        // Prepare plugin options

        const routes = server.table();
        for (const route of routes) {
            if ('nipo' in route.settings.plugins) {
                route.settings.plugins.nipo = Joi.attempt(route.settings.plugins.nipo, internals.configSchema);
            }
        }
    });
};


module.exports = {
    pkg: require('../package.json'),
    requirements: {
        hapi: '>=18.0.0'
    },
    register: internals.register
};
