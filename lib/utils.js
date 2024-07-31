'use strict';

exports.safeJsonObject = function (obj, parentKey = '', stack = []) {

    if (obj === undefined || obj === null) {
        return obj;
    }

    const origObj = obj;
    if (typeof obj.toJSON === 'function') {
        obj = obj.toJSON(parentKey);
    }

    const type = typeof obj;
    if (type === 'object') {
        const orig = obj;

        if (stack.includes(origObj)) {
            return '[Circular]';
        }

        stack.push(origObj);

        if (Array.isArray(obj)) {
            for (let i = 0; i < orig.length; ++i) {
                const value = orig[i];
                const jsonValue = exports.safeJsonObject(value, i.toString(), stack);
                if (value !== jsonValue) {
                    if (obj === orig) {
                        obj = obj.slice();
                    }

                    obj[i] = jsonValue;
                }
            }
        }
        else {
            const keys = Object.keys(orig);

            for (const key of keys) {
                const value = orig[key];
                const jsonValue = exports.safeJsonObject(value, key, stack);
                if (value !== jsonValue) {
                    if (obj === orig) {
                        obj = Object.assign(Object.create(null), orig);
                    }

                    obj[key] = jsonValue;
                }
            }
        }

        stack.pop();
    }
    else if (type === 'bigint') {
        return `${obj.toString()}n`;
    }

    return obj;
};
