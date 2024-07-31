'use strict';

const Boom = require('@hapi/boom');

const Utils = require('./utils');


const internals = {
    boomCtor: new Boom.Boom().constructor
};


internals.errorName = function (error) {

    if (error.isBoom) {
        let base;

        if (error.constructor === internals.boomCtor) {
            if (error.cause instanceof Error &&
                error.cause.name !== Error.prototype.name) {

                base = error.cause.name;
            }
            else if (error.name !== error.constructor.name) {
                base = error.name;
            }
        }
        else {
            base = error.name;
        }

        return base ? `Boom(${base})` : 'Boom';
    }

    return error.name;
};


internals.errorCause = function (error) {

    let cause = error.cause;

    if (cause === undefined &&
        error.isBoom &&
        error.data instanceof Error) {

        cause = error.data;
    }

    return cause;
};


internals.addCause = function (serialized, error, withStack, seen) {

    if (error === undefined) {
        return serialized;
    }

    // Ensure we don't go circular

    if (seen.has(error)) {
        withStack && (serialized.stack += '\ncauses have become circular...');
        serialized.message += ': ...';
        return serialized;
    }

    serialized.message += ': ' + (error.message ?? error);

    if (error instanceof Error) {
        seen.add(error);

        if (withStack) {
            serialized.stack += '\ncaused by: ' + (error.stack ?? '<unknown>');
        }

        const cause = internals.errorCause(error);
        return internals.addCause(serialized, cause, withStack, seen);
    }

    return serialized;
};


internals.errSerializer = function (error, withStack = true) {

    if (!(error instanceof Error)) {
        return error;
    }

    const message = `${error.message}`;
    const cause = internals.errorCause(error);
    const type = internals.errorName(error);
    let { data, code } = error;

    if (error.isBoom) {
        if (data === cause) {
            data = undefined;
        }

        if (code === undefined) {
            code = error.output?.statusCode;
        }
    }

    const res = {
        type,
        message: `${message}`,
        code: Utils.safeJsonObject(code),
        ...((data !== null && data !== undefined) ? {
            data: Utils.safeJsonObject(data)
        } : undefined),
        ...(withStack ? {
            stack: Utils.safeJsonObject(error.stack)
        } : undefined)
    };

    withStack &= typeof error.stack === 'string';

    return internals.addCause(res, cause, withStack, new Set([error]));
};


exports.serializers = {
    err: internals.errSerializer
};
