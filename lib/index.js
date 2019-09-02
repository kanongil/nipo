'use strict';

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

    this.info({
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


internals.onLogAppHandler = function (server, event) {

    this.info({
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


internals.levelSchema = (function () {

    const pinoLevels = Pino().levels;

    return Joi.alternatives(
        Joi.number().integer().min(0).allow(Infinity),
        Joi.string().only(...Object.keys(pinoLevels.values), 'silent')
    );
})();


internals.optionsSchema = Joi.object({
    logResponse: Joi.func(),
    stream: Joi.object({
        writable: Joi.boolean().only(true)
    }).unknown(),

    pino: Joi.object({
        name: Joi.string(),
        level: internals.levelSchema,
        redact: Joi.alternatives(
            Joi.array().items(Joi.string()).single(),
            Joi.object({
                paths: Joi.array().items(Joi.string()).single(),
                censor: Joi.alternatives(Joi.string(), Joi.func()),
                remove: Joi.boolean()
            })
        ),
        enabled: Joi.boolean().default(true),
        crlf: Joi.boolean(),
        timestamp: Joi.alternatives(Joi.boolean(), Joi.func()).default(true),
        messageKey: Joi.string(),
        //$lab:coverage:off$
        prettyPrint: internals.hasPretty ? Joi.boolean() : Joi.boolean().only(false),
        //$lab:coverage:on$
        useLevelLabels: Joi.boolean(),
        changeLevelName: Joi.string()
    }).default({})
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

    const responseLogger = fixedLogger(options.pino, options.stream || Pino.destination(process.stdout.fd));
    const eventLogger = fixedLogger(options.pino, options.stream || Pino.destination(process.stderr.fd));

    const nipo = {};
    Object.defineProperty(nipo, 'responseLogger', { value: responseLogger });
    Object.defineProperty(nipo, 'eventLogger', { value: eventLogger });
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
        logApp: safeHandler('onLogAppHandler', server.info.id)
    };

    eventLogger.on('level-change', internals.onLevelChange.bind(eventLogger, server));
    internals.onLevelChange.call(eventLogger, server, eventLogger.level, eventLogger.levelVal);

    server.events.on('start', safeHandler('onServerState', server, 'started'));
    server.events.on('stop', safeHandler('onServerState', server, 'stopped'));
};


module.exports = {
    pkg: require('../package.json'),
    requirements: {
        hapi: '>=18.0.0'
    },
    register: internals.register
};
