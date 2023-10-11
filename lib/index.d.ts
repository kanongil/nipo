/// <reference types="node" />

import { Stream } from 'node:stream';

import { Plugin, Request } from '@hapi/hapi';
import { Logger, LoggerOptions, Level } from 'pino';

type AllowedPinoOptions = 'name' | 'level' | 'redact' | 'formatters' | 'enabled' | 'crlf' | 'timestamp' | 'messageKey';

export interface NipoRegistrationOptions {

    /**
     * Filter function called for each logged response to potentially change logging level.
     *
     * @param request - Hapi `Request` object from response.
     *
     * @returns `false` to skip logging, `true` to log unchanged, or a log level `string` with desired log level.
     */
    logResponse?: (request: Request) => boolean | Level;

    /**
     * Custom tag level mapping.
     *
     * Each key represents the tag name, and the value is corresponding the log level.
     */
    tagLevels?: { [key: string]: Level };

    /**
     * Output stream to write to instead of default stdout and stderr.
     */
    stream?: Stream;

    /**
     * Pino logger options passed to constructor.
     */
    pino?: Pick<LoggerOptions, AllowedPinoOptions> & {

        /**
        * Use pino-pretty for output formatting.
         */
        prettyPrint?: boolean;
    };
}

export const plugin: Plugin<NipoRegistrationOptions> & {
    pkg: {
        name: 'nipo',
        version: string
    }
};

/**
 * Path to a `request` object property.
 *
 * Can be a dot (.) delimited string, or an array with the chain of property names.
 */
type RequestPropertyPath = string | readonly (string | symbol)[];

type PropertyKeyMapping = { [key: string]: RequestPropertyPath };

export interface NipoPluginSpecificConfiguration {
    /**
     * Map of properties to copy to the serialized 'req' property from the current `request`.
     *
     * The key is the assigned property name, and the mapping is a dot (.) delimited string,
     * or an array with the chain of property names.
     */
    req: PropertyKeyMapping;

    /**
     * Map of properties to copy to the serialized 'res' property from the current `request`.
     *
     * The key is the assigned property name, and the mapping is a dot (.) delimited string,
     * or an array with the chain of property names.
     */
    res: PropertyKeyMapping;
}

// Extend hapi typings

declare module '@hapi/hapi' {
    interface PluginProperties {
        readonly nipo: {
            /**
             * The raw Pino response logger. Default logs to `process.stdout`.
             * 
             * This can be used to update the logging `level` during runtime.
             */
            readonly responseLogger: Logger;

            /**
             * The raw Pino event logger. Default logs to `process.stderr`.
             * 
             * This can be used to update the logging `level` during runtime.
             */
            readonly eventLogger: Logger;

            /**
             * Map of tagLevels, including custom levels from registration options.
             */
            readonly tagLevels: Map<string, Level>;
        }
    }

    interface PluginSpecificConfiguration {
        nipo: NipoPluginSpecificConfiguration
    }
}
